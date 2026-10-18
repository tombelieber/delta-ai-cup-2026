import { createHmac, timingSafeEqual } from 'node:crypto';

// A separate-purpose capability for the single-owner MVP. It never exposes the
// signing key and is never bundled with a public page or extension download.
export function createMapAccess({ env = process.env } = {}) {
  const encoded = env.LEARNING_SIGNING_KEY_BASE64;
  const key = typeof encoded === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(encoded) ? Buffer.from(encoded, 'base64') : null;
  const valid = key?.length === 32 && key.toString('base64') === encoded;
  const token = valid ? createHmac('sha256', key).update('delta-map-personal-access-v1').digest('base64url') : null;
  return {
    configured: Boolean(token),
    // Only the private owner setup script calls this; HTTP never returns it.
    ownerToken() { return token; },
    accepts(value) {
      if (!token || typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) return false;
      return timingSafeEqual(Buffer.from(token), Buffer.from(value));
    },
  };
}
