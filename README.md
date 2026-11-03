# StudioSpace Express backend

All API handlers, Better Auth, MongoDB access and ImgBB uploads run in this folder.

## Run locally

Use Node.js 20 or newer. Install dependencies with `npm install`, configure `.env` from `.env.example`, and start with `npm start` (or `npm run dev`). Preserve existing secrets. The frontend runs separately on port 3000.

Set `BETTER_AUTH_URL` and `FRONTEND_URL` to the public frontend origin. Next.js forwards `/api/*` to Express using `BACKEND_API_URL`, so browser cookies stay on the frontend origin. Register the Google callback as `http://localhost:3000/api/auth/callback/google` locally. Keep database, OAuth, auth-signing and ImgBB secrets only in this backend.

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| GET /api/studios | Public studio list |
| GET /api/studios/featured | Six newest records using MongoDB sort + limit(6) |
| GET /api/studios/:id | Public details, including stored images/host/reviews |
| GET /api/categories | Public categories |
| GET /api/categories/:slug/studios | Public category listings |
| POST /api/studios | Create studio with session-derived owner name/email/ID |
| PATCH /api/studios/:id | Update an owned studio |
| DELETE /api/studios/:id | Delete an owned studio without active bookings |
| POST /api/studios/booking | Create a pending booking; derive userEmail from session and recalculate price |
| GET /api/studios/my-booking?email=... | Find bookings by userEmail, after verifying the requested email belongs to the session |
| GET /api/studios/my-listings?email=... | Find studios by ownerEmail |
| PATCH /api/studios/booking/:id/cancel | Cancel only your own pending booking |
| GET /api/dashboard | Dashboard data scoped to the session |
| GET /api/dashboard?summary=true | Booking/unread counters |
| GET /api/dashboard?view=saved | Saved studio IDs |
| POST /api/dashboard | Host booking decisions, wishlist and messages |
| POST /api/newsletter | Save an email subscription idempotently; no email campaigns are sent |

Specific routes are registered before /api/studios/:id.

Authentication endpoints: `/api/auth/*`. Image uploads: `POST /api/upload` (authenticated multipart image, maximum 5 MB).

Express verifies sessions directly with Better Auth and enforces ownership and allowed origins.

## Data and booking behavior

- Existing collections are preserved: studios, categories, studiosBooking, savedSpaces and studioMessages. studiosBooking is retained to avoid losing your existing records, even though the assignment calls it bookings.
- New records use ownerEmail for listing ownership and userEmail for booking ownership. Old records need those fields populated through a trusted migration. Do not let a visitor claim a listing by editing an email field.
- Status values are lowercase in MongoDB and shown as readable badges: Pending, Confirmed, Completed, Cancelled, Rejected.
- Cancellation is allowed only while Pending. Hosts may confirm/reject requests and mark confirmed bookings complete after their end time.
- Confirmed time overlap is checked before creating a request and before confirming it. Adjacent time slots are allowed. These checks are not a transaction-level concurrency guarantee; simultaneous host confirmations should be hardened with transactional locking before production-scale use.
- Image URL plus optional images array produce the gallery. reviews is an optional stored array of { name, rating, comment }; absent reviews show an honest empty state. No fake reviews are created.
- Existing studio rates are authoritative; client totals are ignored. No payment integration is included.

## Optional checks

`node scripts/check-dashboard.cjs` runs offline handler checks. `node scripts/check-auth.mjs` checks auth against a temporary database and removes that temporary database afterwards. These scripts were moved with the backend and were not executed during migration.
