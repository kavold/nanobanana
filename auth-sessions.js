const crypto = require('node:crypto');

function constantTimeEqual(received, expected) {
  if (typeof received !== 'string' || typeof expected !== 'string') return false;
  const digest = value => crypto.createHash('sha256').update(value).digest();
  return crypto.timingSafeEqual(digest(received), digest(expected));
}

// Opaque, random tokens; only their digests are kept in process memory.
// Restarting the process invalidates sessions instead of accepting old cookies.
function createAuthSessions({ ttlMs, maxSessions = 64, now = Date.now }) {
  const sessions = new Map();
  const digest = token => crypto.createHash('sha256').update(token).digest('hex');
  function validToken(token) { return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token); }
  function cleanup() {
    for (const [id, expires] of sessions) if (expires <= now()) sessions.delete(id);
  }
  return {
    issue() {
      cleanup();
      while (sessions.size >= maxSessions) sessions.delete(sessions.keys().next().value);
      const token = crypto.randomBytes(32).toString('base64url');
      sessions.set(digest(token), now() + ttlMs);
      return token;
    },
    valid(token) {
      if (!validToken(token)) return false;
      const id = digest(token);
      const expires = sessions.get(id);
      if (!expires || expires <= now()) { sessions.delete(id); return false; }
      return true;
    },
    revoke(token) { if (validToken(token)) sessions.delete(digest(token)); }
  };
}

module.exports = { createAuthSessions, constantTimeEqual };
