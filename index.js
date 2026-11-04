import express from 'express';
import cors from 'cors';
import { ObjectId } from 'mongodb';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import { auth } from './auth.mjs';
import { client, db } from './mongodb.mjs';
import { uploadImage } from './upload.mjs';
import 'dotenv/config';
import { createDashboardHandlers } from './dashboard-handlers.mjs';
import { createJwt, jwtCookieName, jwtCookieOptions, verifyJwt } from './jwt.mjs';

const app = express();
const frontend = process.env.FRONTEND_URL || 'http://localhost:3000';
app.use(cors({ origin: frontend, credentials: true }));
async function getSession(req) {
     return auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
}

function trustedMutationOrigin(req, res) {
     if (req.get('origin') === frontend) return true;
     res.status(403).json({ message: 'Untrusted request origin.' });
     return false;
}

function cookieValue(req, name) {
     const prefix = `${name}=`;
     const value = (req.get('cookie') || '')
          .split(';')
          .map((item) => item.trim())
          .find((item) => item.startsWith(prefix));
     return value ? decodeURIComponent(value.slice(prefix.length)) : undefined;
}

app.post('/api/auth/jwt', async (req, res) => {
     if (!trustedMutationOrigin(req, res)) return;
     try {
          const session = await getSession(req);
          if (!session?.user) return res.status(401).json({ message: 'Please log in.' });
          res.cookie(jwtCookieName, createJwt(session.user), jwtCookieOptions).json({ success: true });
     } catch {
          res.status(503).json({ message: 'Authentication service unavailable.' });
     }
});

app.delete('/api/auth/jwt', (req, res) => {
     if (!trustedMutationOrigin(req, res)) return;
     res.clearCookie(jwtCookieName, jwtCookieOptions).json({ success: true });
});

// Better Auth consumes the raw request body, before express.json().
app.all('/api/auth/*splat', toNodeHandler(auth));
app.use(express.json({ limit: '1mb' }));
await client.connect();
const studios = db.collection('studios');
const bookings = db.collection('studiosBooking');
const dashboard = createDashboardHandlers(db);
const validId = (id) => typeof id === 'string' && /^[a-f\d]{24}$/i.test(id);

// Validate sessions directly in the backend.
async function requireUser(req, res, next) {
     if (!['GET', 'HEAD'].includes(req.method) && !trustedMutationOrigin(req, res)) return;
     try {
          const jwtUser = verifyJwt(cookieValue(req, jwtCookieName));
          if (!jwtUser) return res.status(401).json({ message: 'Please log in.' });
          const session = await getSession(req);
          if (!session?.user) return res.status(401).json({ message: 'Please log in.' });
          if (session.user.id !== jwtUser.id || session.user.email !== jwtUser.email)
               return res.status(401).json({ message: 'Please log in.' });
          req.user = session.user;
          next();
     } catch {
          res.status(503).json({ message: 'Authentication service unavailable.' });
     }
}

function dashboardHandler(method, action) {
     return async (req, res, next) => {
          try {
               const request = {
                    session: { user: req.user },
                    headers: fromNodeHeaders(req.headers),
                    nextUrl: new URL(req.originalUrl, frontend),
                    json: async () =>
                         action
                              ? {
                                     ...req.body,
                                     action,
                                     ...(req.params.id ? { id: req.params.id } : {}),
                                }
                              : req.body,
               };
               const result = await dashboard[method](request);
               res.status(result.status)
                    .set(Object.fromEntries(result.headers))
                    .json(await result.json());
          } catch (error) {
               next(error);
          }
     };
}

app.post(
     '/api/upload',
     requireUser,
     express.raw({ type: 'multipart/form-data', limit: '6mb' }),
     uploadImage,
);

app.get('/api/categories', async (req, res, next) => {
     try {
          res.json(await db.collection('categories').find().toArray());
     } catch (error) {
          next(error);
     }
});
app.get('/api/categories/:slug/studios', async (req, res, next) => {
     try {
          res.json(await studios.find({ category: req.params.slug }).toArray());
     } catch (error) {
          next(error);
     }
});
app.get('/api/studios/featured', async (req, res, next) => {
     try {
          res.json(await studios.find().sort({ _id: -1 }).limit(6).toArray());
     } catch (error) {
          next(error);
     }
});
app.get('/api/studios/my-booking', requireUser, async (req, res, next) => {
     if (req.query.email !== req.user.email)
          return res.status(403).json({ message: 'You can only view your own bookings.' });
     try {
          res.json(
               await bookings.find({ userEmail: req.user.email }).sort({ createdAt: -1 }).toArray(),
          );
     } catch (error) {
          next(error);
     }
});
app.get('/api/studios/my-listings', requireUser, async (req, res, next) => {
     if (req.query.email !== req.user.email)
          return res.status(403).json({ message: 'You can only view your own listings.' });
     try {
          res.json(await studios.find({ ownerEmail: req.user.email }).sort({ _id: -1 }).toArray());
     } catch (error) {
          next(error);
     }
});
app.get('/api/studios', async (req, res, next) => {
     try {
          res.json(await studios.find().sort({ _id: -1 }).toArray());
     } catch (error) {
          next(error);
     }
});
app.post('/api/studios', requireUser, async (req, res, next) => {
     const fields = [
          'title',
          'category',
          'description',
          'squareFootage',
          'ceilingHeight',
          'maxCapacity',
          'powerSupply',
          'imageUrl',
          'hourlyRate',
          'securityDeposit',
          'minimumBookingHours',
          'streetAddress',
          'city',
          'postalCode',
          'overtimePolicy',
          'houseRules',
     ];
     const studio = Object.fromEntries(
          fields.map((key) => [key, typeof req.body[key] === 'string' ? req.body[key].trim() : '']),
     );
     if (
          !studio.title ||
          !studio.category ||
          !studio.hourlyRate ||
          !Number.isFinite(Number(studio.hourlyRate)) ||
          Number(studio.hourlyRate) < 0
     )
          return res
               .status(400)
               .json({ message: 'Enter a title, category and valid hourly rate.' });
     studio.amenities = Array.isArray(req.body.amenities)
          ? req.body.amenities.filter((item) => typeof item === 'string')
          : [];
     studio.images = Array.isArray(req.body.images)
          ? req.body.images
                 .filter((item) => typeof item === 'string' && /^https?:\/\//.test(item))
                 .slice(0, 10)
          : [];
     Object.assign(studio, {
          email: req.user.email,
          ownerEmail: req.user.email,
          ownerName: req.user.name,
          ownerId: req.user.id,
          createdAt: new Date().toISOString(),
     });
     try {
          res.status(201).json(await studios.insertOne(studio));
     } catch (error) {
          next(error);
     }
});
app.post('/api/studios/booking', requireUser, dashboardHandler('POST', 'book'));
app.patch(
     '/api/studios/booking/:id/cancel',
     requireUser,
     dashboardHandler('POST', 'cancelBooking'),
);
app.patch('/api/studios/:id', requireUser, (req, res, next) => {
     req.body = { studio: req.body };
     return dashboardHandler('POST', 'editStudio')(req, res, next);
});
app.delete('/api/studios/:id', requireUser, dashboardHandler('POST', 'deleteStudio'));
app.get('/api/studios/:id', async (req, res, next) => {
     if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid studio ID.' });
     try {
          const studio = await studios.findOne({ _id: new ObjectId(req.params.id) });
          if (!studio) return res.status(404).json({ message: 'Studio not found.' });
          res.json(studio);
     } catch (error) {
          next(error);
     }
});
app.get('/api/dashboard', requireUser, dashboardHandler('GET'));
app.post('/api/dashboard', requireUser, dashboardHandler('POST'));
app.post('/api/newsletter', async (req, res, next) => {
     if (!trustedMutationOrigin(req, res)) return;
     const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
     if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
          return res.status(400).json({ message: 'Enter a valid email address.' });
     try {
          await db
               .collection('newsletterSubscriptions')
               .updateOne(
                    { _id: email },
                    { $setOnInsert: { email, createdAt: new Date().toISOString() } },
                    { upsert: true },
               );
          res.json({ success: true });
     } catch (error) {
          next(error);
     }
});
app.get('/', (req, res) => res.send('StudioSpace server is running'));
app.use((error, req, res, next) => {
     console.error('API request failed:', error.name);
     res.status(500).json({ message: 'Unable to complete the request. Please try again.' });
});
app.listen(process.env.PORT || 8000, () => console.log('StudioSpace API is running'));
