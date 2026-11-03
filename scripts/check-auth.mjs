// Uses a new isolated database, never the configured application database.
// Run: node scripts/check-auth.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import 'dotenv/config';

const testDatabase = `studiospace_auth_test_${crypto.randomBytes(8).toString('hex')}`;
process.env.MONGODB_DB_NAME = testDatabase;
process.env.BETTER_AUTH_URL = 'http://localhost:3000';
// Isolate signing keys too; do not depend on the app's configured session key.
process.env.BETTER_AUTH_SECRET = crypto.randomBytes(32).toString('hex');
process.env.NODE_ENV = 'test';

let client;
try {
     const { auth } = await import('../auth.mjs');
     ({ client } = await import('../mongodb.mjs'));
     await client.connect();
     const password = `Test${crypto.randomBytes(12).toString('hex')}`;
     const email = `auth-test-${crypto.randomBytes(6).toString('hex')}@example.com`;

     async function request(path, body, cookie = '') {
          return auth.handler(new Request(`http://localhost:3000/api/auth${path}`, {
               method: body ? 'POST' : 'GET',
               headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', Cookie: cookie },
               ...(body ? { body: JSON.stringify(body) } : {}),
          }));
     }

     const weak = await request('/sign-up/email', { name: 'Auth Test', email, password: 'lowercase123' });
     assert.equal(weak.status, 400);
     const signup = await request('/sign-up/email', { name: 'Auth Test', email, password });
     assert.equal(signup.status, 200, 'Signup must succeed');
     const registered = await signup.json();
     assert.equal(registered.user.email, email);
     assert(!signup.headers.get('set-cookie')?.includes('session_token'), 'Signup must not auto-login');

     const duplicate = await request('/sign-up/email', { name: 'Auth Test', email, password });
     assert([200, 400, 422].includes(duplicate.status));
     assert.equal(await client.db(testDatabase).collection('user').countDocuments({ email }), 1, 'Duplicate signup must not create another account');
     const wrongPassword = await request('/sign-in/email', { email, password: 'WrongPassword123' });
     assert.equal(wrongPassword.status, 401);

     const login = await request('/sign-in/email', { email, password, rememberMe: true });
     assert.equal(login.status, 200, 'Email login must succeed');
     const cookies = login.headers.getSetCookie();
     assert(cookies.some((cookie) => /session_token=.*httponly/i.test(cookie)), 'Session cookie must be HttpOnly');
     const cookie = cookies.map((value) => value.split(';')[0]).join('; ');
     for (let i = 0; i < 2; i++) {
          const session = await request('/get-session', undefined, cookie);
          assert.equal(session.status, 200);
          assert.equal((await session.json()).user.email, email);
     }
     const logout = await request('/sign-out', {}, cookie);
     assert.equal(logout.status, 200);
     const signedOut = await request('/get-session', undefined, cookie);
     assert.equal(await signedOut.json(), null, 'Logout must revoke the session');
     console.log('PASS: password rules, signup, duplicate rejection, login, wrong password, HttpOnly session, session persistence, logout.');

     if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
          const google = await request('/sign-in/social', { provider: 'google', callbackURL: '/', disableRedirect: true });
          assert.equal(google.status, 200);
          const result = await google.json();
          assert.equal(new URL(result.url).hostname, 'accounts.google.com');
          console.log('PASS: Google authorization URL generation. Consent and callback exchange still require a browser login.');
     }
} catch (error) {
     // Avoid printing errors that could contain a connection string or auth tokens.
     console.error('Auth integration check failed:', error.name, error.code || '', error instanceof assert.AssertionError ? error.message : 'Check database connectivity and credentials.');
     process.exitCode = 1;
} finally {
     if (client) {
          try {
               assert(/^studiospace_auth_test_[a-f0-9]{16}$/.test(testDatabase));
               await client.db(testDatabase).dropDatabase();
               console.log('Temporary auth test database removed.');
          } catch {
               console.error(`Could not remove test database ${testDatabase}; remove this test database manually if it exists.`);
               process.exitCode = 1;
          }
          await client.close();
     }
}
