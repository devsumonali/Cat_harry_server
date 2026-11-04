import crypto from 'node:crypto';

const tokenLifetimeSeconds = 60 * 60 * 8;

function encode(value) {
     return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decode(value) {
     return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function secret() {
     const value = process.env.JWT_SECRET;
     if (!value || value.length < 32) throw new Error('JWT_SECRET is not configured.');
     return value;
}

function signature(input) {
     return crypto.createHmac('sha256', secret()).update(input).digest('base64url');
}

export function createJwt(user) {
     const now = Math.floor(Date.now() / 1000);
     const header = encode({ alg: 'HS256', typ: 'JWT' });
     const payload = encode({ sub: user.id, email: user.email, iat: now, exp: now + tokenLifetimeSeconds });
     const input = `${header}.${payload}`;
     return `${input}.${signature(input)}`;
}

export function verifyJwt(token) {
     if (typeof token !== 'string') return null;
     const parts = token.split('.');
     if (parts.length !== 3) return null;
     const [headerValue, payloadValue, receivedSignature] = parts;
     const input = `${headerValue}.${payloadValue}`;
     const expectedSignature = signature(input);
     const received = Buffer.from(receivedSignature);
     const expected = Buffer.from(expectedSignature);
     if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return null;
     try {
          const header = decode(headerValue);
          const payload = decode(payloadValue);
          if (
               header.alg !== 'HS256' ||
               typeof payload.sub !== 'string' ||
               typeof payload.email !== 'string' ||
               !Number.isFinite(payload.exp) ||
               payload.exp <= Math.floor(Date.now() / 1000)
          )
               return null;
          return { id: payload.sub, email: payload.email };
     } catch {
          return null;
     }
}

export const jwtCookieName = 'studiospace_jwt';
export const jwtCookieOptions = {
     httpOnly: true,
     maxAge: tokenLifetimeSeconds * 1000,
     sameSite: 'lax',
     secure: process.env.NODE_ENV === 'production',
     path: '/',
};
