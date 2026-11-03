// Offline handler tests. No application database or credentials are used.
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
class NextRequest extends Request { get nextUrl() { return new URL(this.url); } }

let session = null;
const tables = new Map();
const equal = (a, b) => String(a) === String(b);
function matches(row, filter) {
     return Object.entries(filter).every(([key, value]) => {
          if (key === '$or') return value.some((part) => matches(row, part));
          if (value && typeof value === 'object' && '$in' in value) return value.$in.some((item) => equal(row[key], item));
          if (value && typeof value === 'object' && '$lt' in value) return row[key] < value.$lt;
          if (value && typeof value === 'object' && '$gt' in value) return row[key] > value.$gt;
          if (value && typeof value === 'object' && '$ne' in value) return !equal(row[key], value.$ne);
          return equal(row[key], value);
     });
}
const db = { collection(name) {
     if (!tables.has(name)) tables.set(name, []);
     const rows = tables.get(name);
     return {
          find(filter = {}, options = {}) {
               let results = rows.filter((row) => matches(row, filter));
               if (options.projection) results = results.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key === '_id' || options.projection[key])));
               return { sort() { return this; }, async toArray() { return results; } };
          },
          async findOne(filter) { return rows.find((row) => matches(row, filter)) || null; },
          async countDocuments(filter) { return rows.filter((row) => matches(row, filter)).length; },
          async insertOne(row) { const stored = { ...row, _id: row._id || new ObjectId() }; rows.push(stored); return { acknowledged: true, insertedId: stored._id }; },
          async updateOne(filter, update, options = {}) {
               const row = rows.find((row) => matches(row, filter));
               if (row) { Object.assign(row, update.$set || {}); return { matchedCount: 1, modifiedCount: update.$set ? 1 : 0 }; }
               if (options.upsert) rows.push({ ...filter, ...(update.$setOnInsert || {}), ...(update.$set || {}) });
               return { matchedCount: 0, modifiedCount: 0 };
          },
          async deleteOne(filter) { const index = rows.findIndex((row) => matches(row, filter)); if (index >= 0) rows.splice(index, 1); return { deletedCount: index >= 0 ? 1 : 0 }; },
          async deleteMany(filter) { for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], filter)) rows.splice(i, 1); },
     };
} };

let route;
const user = (id) => ({ user: { id, name: id, email: `${id}@example.com` } });
async function post(body, origin = 'http://localhost:3000') {
     const request = new NextRequest('http://localhost:3000/api/dashboard', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) }); request.session = session; return route.POST(request);
}
async function get() { const request = new NextRequest('http://localhost:3000/api/dashboard'); request.session = session; return route.GET(request); }

(async () => {
     route = (await import('../dashboard-handlers.mjs')).createDashboardHandlers(db);
     assert.equal((await get()).status, 401);
     assert.equal((await post({})).status, 401);
     session = user('host');
     assert.equal((await post({}, 'https://untrusted.example')).status, 403);
     await db.collection('studios').insertOne({title: 'Test Studio', category: 'podcast', hourlyRate: '50', securityDeposit: '10', minimumBookingHours: '2', maxCapacity: '5', email: 'host@example.com', ownerEmail: 'host@example.com', ownerId: 'host'});
     const studio = tables.get('studios')[0];
     const id = studio._id.toString();
     session = user('guest');
     const response = await post({ action: 'book', studioId: id, bookingDate: '2099-01-02', startTime: '09:00', endTime: '11:00', guestCount: 2, userId: 'spoof', userEmail: 'spoof@example.com', totalAmount: 1, status: 'confirmed' });
     assert.equal(response.status, 200);
     const bookingId = (await response.json()).insertedId;
     const booking = tables.get('studiosBooking')[0];
     assert.equal(booking.userId, 'guest');
     assert.equal(booking.userEmail, 'guest@example.com');
     assert.equal(booking.totalAmount, 110);
     assert.equal(booking.status, 'pending');
     assert.equal((await post({ action: 'book', studioId: id, bookingDate: '2099-01-02', startTime: '09:00', endTime: '10:00', guestCount: 2 })).status, 400);
     assert.equal((await post({ action: 'confirmBooking', id: bookingId })).status, 404);
     assert.equal((await post({ action: 'deleteStudio', id })).status, 404);
     assert.equal((await post({ action: 'editStudio', id, studio: { title: 'Hijack', category: 'podcast', hourlyRate: '1' } })).status, 404);
     assert.equal((await post({ action: 'saveStudio', id })).status, 200);
     assert.equal((await post({ action: 'saveStudio', id })).status, 200);
     assert.equal(tables.get('savedSpaces').length, 1);
     assert.equal((await post({ action: 'sendMessage', id, text: 'Hello host', recipientId: 'spoof' })).status, 200);
     assert.equal(tables.get('studioMessages')[0].recipientId, 'host');
     assert.equal((await (await get()).json()).bookings.length, 1);

     session = user('stranger');
     const other = await (await get()).json();
     assert.equal(other.bookings.length, 0);
     assert.equal(other.incomingBookings.length, 0);
     assert.equal(other.messages.length, 0);
     assert.equal(other.savedSpaces.length, 0);
     assert.equal(other.studios.length, 0);
     assert.equal(other.availableStudios[0].email, undefined);
     assert.equal((await post({ action: 'cancelBooking', id: bookingId })).status, 409);

     session = user('host');
     assert.equal((await (await get()).json()).incomingBookings.length, 1);
     assert.equal((await post({ action: 'confirmBooking', id: bookingId })).status, 200);
     assert.equal((await post({ action: 'confirmBooking', id: bookingId })).status, 409);
     assert.equal((await post({ action: 'deleteStudio', id })).status, 409);
     assert.equal((await post({ action: 'sendMessage', id, text: 'Unsolicited', recipientId: 'stranger' })).status, 404);
     assert.equal((await post({ action: 'sendMessage', id, text: 'Welcome', recipientId: 'guest' })).status, 200);
     assert.equal((await post({ action: 'editStudio', id, studio: { title: 'Updated', category: 'podcast', hourlyRate: '75', ownerId: 'spoof' } })).status, 200);
     assert.equal(studio.ownerId, 'host');
     assert.equal(studio.title, 'Updated');

     session = user('guest');
     const reply = tables.get('studioMessages')[1];
     assert.equal((await post({ action: 'readMessage', id: reply._id.toString() })).status, 200);
     assert.equal(reply.read, true);
     assert.equal((await post({ action: 'cancelBooking', id: bookingId })).status, 409);
     assert.equal((await post({ action: 'book', studioId: id, bookingDate: '2099-01-02', startTime: '10:00', endTime: '12:00', guestCount: 2 })).status, 409);
     const second = await post({ action: 'book', studioId: id, bookingDate: '2099-01-02', startTime: '11:00', endTime: '13:00', guestCount: 2 });
     assert.equal(second.status, 200);
     const secondId = (await second.json()).insertedId;
     assert.equal((await post({ action: 'cancelBooking', id: secondId })).status, 200);
     assert.equal(tables.get('studiosBooking')[1].status, 'cancelled');
     assert.equal((await post({ action: 'unsaveStudio', id })).status, 200);
     assert.equal(tables.get('savedSpaces').length, 0);
     session = user('host');
     booking.bookingDate = '2000-01-02';
     assert.equal((await post({ action: 'completeBooking', id: bookingId })).status, 200);
     assert.equal(booking.status, 'completed');
     assert.equal((await post({ action: 'deleteStudio', id })).status, 200);
     assert.equal(tables.get('studios').length, 0);
     console.log('PASS: private API, CSRF, email-scoped reads, booking pricing, owner checks, pending-only cancellation, overlap rejection, host completion, saves, messages and read state (offline database adapter).');
})().catch((error) => { console.error(error); process.exitCode = 1; });
