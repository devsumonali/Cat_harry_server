import { ObjectId } from 'mongodb';

export function createDashboardHandlers(db) {
     const json = Response.json;
     const validId = (id) => typeof id === 'string' && /^[a-f\d]{24}$/i.test(id);
     async function GET(request) {
          const session = request.session;
          if (!session) return json({ message: 'Please log in.' }, { status: 401 });
          const userId = session.user.id;
          try {
               if (request.nextUrl.searchParams.get('summary') === 'true') {
                    const [bookingCount, unreadCount] = await Promise.all([
                         db
                              .collection('studiosBooking')
                              .countDocuments({
                                   userEmail: session.user.email,
                                   status: { $in: ['pending', 'confirmed'] },
                              }),
                         db
                              .collection('studioMessages')
                              .countDocuments({ recipientId: userId, read: false }),
                    ]);
                    return json(
                         { bookingCount, hasUnreadMessages: unreadCount > 0 },
                         { headers: { 'Cache-Control': 'private, no-store' } },
                    );
               }
               if (request.nextUrl.searchParams.get('view') === 'saved') {
                    const saved = await db.collection('savedSpaces').find({ userId }).toArray();
                    return json(
                         saved.map((item) => item.studioId),
                         { headers: { 'Cache-Control': 'private, no-store' } },
                    );
               }
               const studios = await db
                    .collection('studios')
                    .find({ ownerEmail: session.user.email })
                    .toArray();
               const studioIds = studios.map((studio) => studio._id.toString());
               const [bookings, incomingBookings, saved, messages, availableStudios] =
                    await Promise.all([
                         db
                              .collection('studiosBooking')
                              .find({ userEmail: session.user.email })
                              .sort({ createdAt: -1 })
                              .toArray(),
                         db
                              .collection('studiosBooking')
                              .find({ studioId: { $in: studioIds } })
                              .sort({ createdAt: -1 })
                              .toArray(),
                         db.collection('savedSpaces').find({ userId }).toArray(),
                         db
                              .collection('studioMessages')
                              .find({ $or: [{ senderId: userId }, { recipientId: userId }] })
                              .sort({ createdAt: -1 })
                              .toArray(),
                         db
                              .collection('studios')
                              .find(
                                   {},
                                   {
                                        projection: {
                                             title: 1,
                                             city: 1,
                                             category: 1,
                                             hourlyRate: 1,
                                             imageUrl: 1,
                                             image: 1,
                                             ownerId: 1,
                                             ownerName: 1,
                                        },
                                   },
                              )
                              .sort({ _id: -1 })
                              .toArray(),
                    ]);
               const savedIds = saved
                    .map((item) => item.studioId)
                    .filter(validId)
                    .map((id) => new ObjectId(id));
               const savedSpaces = await db
                    .collection('studios')
                    .find(
                         { _id: { $in: savedIds } },
                         {
                              projection: {
                                   title: 1,
                                   city: 1,
                                   category: 1,
                                   hourlyRate: 1,
                                   imageUrl: 1,
                                   image: 1,
                              },
                         },
                    )
                    .toArray();
               return json(
                    {
                         userId,
                         studios,
                         bookings,
                         incomingBookings,
                         savedSpaces,
                         messages,
                         availableStudios,
                    },
                    { headers: { 'Cache-Control': 'private, no-store' } },
               );
          } catch {
               return json(
                    { message: 'Unable to load dashboard data. Please try again.' },
                    { status: 503 },
               );
          }
     }
     async function POST(request) {
          // Mutations use the same-origin session cookie; reject cross-site requests.
          if (request.headers.get('origin') !== request.nextUrl.origin)
               return json({ message: 'Invalid request origin.' }, { status: 403 });
          const session = request.session;
          if (!session) return json({ message: 'Please log in.' }, { status: 401 });
          const user = session.user;
          let body;
          try {
               body = await request.json();
          } catch {
               return json({ message: 'Invalid request.' }, { status: 400 });
          }
          if (!body || typeof body !== 'object')
               return json({ message: 'Invalid request.' }, { status: 400 });
          const { action, id } = body;
          try {
               if (action === 'book') {
                    if (!validId(body.studioId))
                         return json({ message: 'Invalid studio.' }, { status: 400 });
                    const studio = await db
                         .collection('studios')
                         .findOne({ _id: new ObjectId(body.studioId) });
                    if (!studio) return json({ message: 'Studio not found.' }, { status: 404 });
                    const { bookingDate, startTime, endTime, guestCount } = body;
                    if (
                         typeof bookingDate !== 'string' ||
                         !/^\d{4}-\d{2}-\d{2}$/.test(bookingDate) ||
                         typeof startTime !== 'string' ||
                         typeof endTime !== 'string' ||
                         !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) ||
                         !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)
                    ) {
                         return json({ message: 'Choose a valid date and time.' }, { status: 400 });
                    }
                    const start = new Date(`${bookingDate}T${startTime}`);
                    const end = new Date(`${bookingDate}T${endTime}`);
                    const hours = (end.getTime() - start.getTime()) / 3600000;
                    const rate = Number(studio.hourlyRate);
                    const deposit = Math.max(0, Number(studio.securityDeposit) || 0);
                    if (
                         !Number.isFinite(start.getTime()) ||
                         start.getTime() <= Date.now() ||
                         !Number.isFinite(hours) ||
                         hours < (Number(studio.minimumBookingHours) || 1) ||
                         !Number.isInteger(guestCount) ||
                         guestCount < 1 ||
                         (Number(studio.maxCapacity) > 0 &&
                              guestCount > Number(studio.maxCapacity)) ||
                         String(studio.hourlyRate ?? '').trim() === '' ||
                         !Number.isFinite(rate) ||
                         rate < 0
                    ) {
                         return json(
                              {
                                   message: 'Check the booking date, minimum hours and guest capacity.',
                              },
                              { status: 400 },
                         );
                    }
                    if (
                         await db
                              .collection('studiosBooking')
                              .findOne({
                                   studioId: body.studioId,
                                   bookingDate,
                                   status: 'confirmed',
                                   startTime: { $lt: endTime },
                                   endTime: { $gt: startTime },
                              })
                    ) {
                         return json(
                              {
                                   message: 'This time overlaps an existing confirmed booking. Choose another slot.',
                              },
                              { status: 409 },
                         );
                    }
                    const result = await db.collection('studiosBooking').insertOne({
                         studioId: body.studioId,
                         studioTitle: studio.title,
                         userId: user.id,
                         userEmail: user.email,
                         userName: user.name,
                         bookingDate,
                         startTime,
                         endTime,
                         guestCount,
                         hourlyRate: rate,
                         totalHours: hours,
                         securityDeposit: deposit,
                         totalAmount: Math.round((rate * hours + deposit) * 100) / 100,
                         status: 'pending',
                         createdAt: new Date().toISOString(),
                    });
                    return json(result);
               }
               if (!validId(id)) return json({ message: 'Invalid item.' }, { status: 400 });
               const _id = new ObjectId(id);
               if (action === 'cancelBooking') {
                    const result = await db
                         .collection('studiosBooking')
                         .updateOne(
                              { _id, userEmail: user.email, status: 'pending' },
                              { $set: { status: 'cancelled' } },
                         );
                    if (!result.modifiedCount)
                         return json(
                              { message: 'This booking cannot be cancelled.' },
                              { status: 409 },
                         );
               } else if (
                    action === 'confirmBooking' ||
                    action === 'rejectBooking' ||
                    action === 'completeBooking'
               ) {
                    const booking = await db.collection('studiosBooking').findOne({ _id });
                    const studio =
                         booking &&
                         validId(booking.studioId) &&
                         (await db
                              .collection('studios')
                              .findOne({
                                   _id: new ObjectId(booking.studioId),
                                   ownerEmail: user.email,
                              }));
                    if (!studio) return json({ message: 'Booking not found.' }, { status: 404 });
                    if (
                         action === 'confirmBooking' &&
                         (await db
                              .collection('studiosBooking')
                              .findOne({
                                   _id: { $ne: _id },
                                   studioId: booking.studioId,
                                   bookingDate: booking.bookingDate,
                                   status: 'confirmed',
                                   startTime: { $lt: booking.endTime },
                                   endTime: { $gt: booking.startTime },
                              }))
                    )
                         return json(
                              { message: 'Another confirmed booking overlaps this slot.' },
                              { status: 409 },
                         );
                    if (
                         action === 'completeBooking' &&
                         new Date(`${booking.bookingDate}T${booking.endTime}`).getTime() >
                              Date.now()
                    )
                         return json(
                              { message: 'A booking can be completed after its end time.' },
                              { status: 400 },
                         );
                    const result = await db.collection('studiosBooking').updateOne(
                         { _id, status: action === 'completeBooking' ? 'confirmed' : 'pending' },
                         {
                              $set: {
                                   status:
                                        action === 'confirmBooking'
                                             ? 'confirmed'
                                             : action === 'completeBooking'
                                               ? 'completed'
                                               : 'rejected',
                              },
                         },
                    );
                    if (!result.modifiedCount)
                         return json(
                              { message: 'This booking has already been updated.' },
                              { status: 409 },
                         );
               } else if (action === 'saveStudio') {
                    if (!(await db.collection('studios').findOne({ _id })))
                         return json({ message: 'Studio not found.' }, { status: 404 });
                    // Deterministic ID makes repeated saves idempotent without an index migration.
                    await db
                         .collection('savedSpaces')
                         .updateOne(
                              { _id: `${user.id}:${id}` },
                              { $setOnInsert: { userId: user.id, studioId: id } },
                              { upsert: true },
                         );
               } else if (action === 'unsaveStudio') {
                    await db
                         .collection('savedSpaces')
                         .deleteMany({ userId: user.id, studioId: id });
               } else if (action === 'editStudio') {
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
                    const updates = Object.fromEntries(
                         fields
                              .filter((field) => typeof body.studio?.[field] === 'string')
                              .map((field) => [field, body.studio[field].trim()]),
                    );
                    if (
                         !updates.title ||
                         !updates.category ||
                         !updates.hourlyRate ||
                         !Number.isFinite(Number(updates.hourlyRate)) ||
                         Number(updates.hourlyRate) < 0
                    )
                         return json(
                              { message: 'Enter a title, category and valid hourly rate.' },
                              { status: 400 },
                         );
                    if (Array.isArray(body.studio.amenities))
                         updates.amenities = body.studio.amenities.filter(
                              (item) => typeof item === 'string',
                         );
                    if (Array.isArray(body.studio.images))
                         updates.images = body.studio.images
                              .filter(
                                   (item) => typeof item === 'string' && /^https?:\/\//.test(item),
                              )
                              .slice(0, 10);
                    const result = await db
                         .collection('studios')
                         .updateOne({ _id, ownerEmail: user.email }, { $set: updates });
                    if (!result.matchedCount)
                         return json({ message: 'Studio not found.' }, { status: 404 });
               } else if (action === 'deleteStudio') {
                    if (!(await db.collection('studios').findOne({ _id, ownerEmail: user.email })))
                         return json({ message: 'Studio not found.' }, { status: 404 });
                    if (
                         await db
                              .collection('studiosBooking')
                              .findOne({ studioId: id, status: { $in: ['pending', 'confirmed'] } })
                    )
                         return json(
                              { message: 'Resolve active bookings before deleting this studio.' },
                              { status: 409 },
                         );
                    await db.collection('studios').deleteOne({ _id, ownerEmail: user.email });
               } else if (action === 'sendMessage') {
                    if (
                         typeof body.text !== 'string' ||
                         !body.text.trim() ||
                         body.text.length > 2000
                    )
                         return json(
                              { message: 'Enter a message of up to 2,000 characters.' },
                              { status: 400 },
                         );
                    const studio = await db.collection('studios').findOne({ _id });
                    if (!studio?.ownerId)
                         return json(
                              { message: 'This studio has no registered host to contact.' },
                              { status: 400 },
                         );
                    let recipientId = studio.ownerId;
                    let recipientName = studio.ownerName || 'Host';
                    if (studio.ownerId === user.id) {
                         // A host may only reply to someone who contacted this studio.
                         if (typeof body.recipientId !== 'string')
                              return json({ message: 'Select a conversation.' }, { status: 400 });
                         const previous = await db.collection('studioMessages').findOne({
                              studioId: id,
                              senderId: body.recipientId,
                              recipientId: user.id,
                         });
                         if (!previous)
                              return json({ message: 'Conversation not found.' }, { status: 404 });
                         recipientId = previous.senderId;
                         recipientName = previous.senderName;
                    }
                    await db.collection('studioMessages').insertOne({
                         studioId: id,
                         studioTitle: studio.title,
                         senderId: user.id,
                         senderName: user.name,
                         recipientId,
                         recipientName,
                         text: body.text.trim(),
                         createdAt: new Date().toISOString(),
                         read: false,
                    });
               } else if (action === 'readMessage') {
                    await db
                         .collection('studioMessages')
                         .updateOne({ _id, recipientId: user.id }, { $set: { read: true } });
               } else return json({ message: 'Unknown action.' }, { status: 400 });
               return json({ success: true });
          } catch {
               return json(
                    { message: 'Unable to save changes. Please try again.' },
                    { status: 503 },
               );
          }
     }

     return { GET, POST };
}
