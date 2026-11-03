import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { mongodbAdapter } from '@better-auth/mongo-adapter';
import { db } from './mongodb.mjs';
import { getPasswordError } from './auth-utils.mjs';

export const auth = betterAuth({
     appName: 'StudioSpace',
     baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
     secret: process.env.BETTER_AUTH_SECRET,
     trustedOrigins: [process.env.FRONTEND_URL || 'http://localhost:3000'],
     database: mongodbAdapter(db),
     emailAndPassword: {
          enabled: true,
          minPasswordLength: 6,
          maxPasswordLength: 128,
          autoSignIn: false,
          requireEmailVerification: false,
     },
     socialProviders: {
          google: {
               clientId: process.env.GOOGLE_CLIENT_ID || '',
               clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
          },
     },
     hooks: {
          before: createAuthMiddleware(async (ctx) => {
               if (ctx.path === '/change-password') {
                    const message = getPasswordError(ctx.body?.newPassword);
                    if (message) throw new APIError('BAD_REQUEST', { message });
               }
               if (ctx.path !== '/sign-up/email') return;
               const message = getPasswordError(ctx.body?.password);
               if (message) throw new APIError('BAD_REQUEST', { message });
               if (typeof ctx.body?.name !== 'string' || !ctx.body.name.trim()) {
                    throw new APIError('BAD_REQUEST', { message: 'Please enter your name.' });
               }
          }),
     },
});
