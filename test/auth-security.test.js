const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { createAuthSessions, constantTimeEqual } = require('../auth-sessions');

test('sessions are random, expire on the server, revoke on logout and reject forged tokens', () => {
  let time = 1000;
  const sessions = createAuthSessions({ ttlMs: 100, maxSessions: 2, now: () => time });
  const first = sessions.issue(); const second = sessions.issue();
  assert.notEqual(first, second); assert.equal(first.length, 43);
  assert.equal(sessions.valid(first), true);
  assert.equal(sessions.valid('a'.repeat(43)), false);
  assert.equal(sessions.valid({ token: first }), false);
  sessions.revoke(first); assert.equal(sessions.valid(first), false);
  time = 1100; assert.equal(sessions.valid(second), false);
  const a = sessions.issue(); sessions.issue(); sessions.issue();
  assert.equal(sessions.valid(a), false, 'session storage is bounded');
  assert.equal(constantTimeEqual('correct', 'correct'), true);
  assert.equal(constantTimeEqual(['correct'], 'correct'), false);
});

test('production refuses anonymous mode even if ALLOW_UNAUTHENTICATED is true', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-startup-test-'));
  try {
    const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.resolve(__dirname, '../server.js'))})`], {
      cwd, env: { PATH: process.env.PATH, NODE_ENV: 'production', ALLOW_UNAUTHENTICATED: 'true' }, encoding: 'utf8'
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Auth credentials are required/);
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});

test('login gate covers generation, video endpoints and files; cookies and brute-force guard are enforced', async t => {
  process.env.NODE_ENV = 'production';
  process.env.BASIC_AUTH_USERNAME = 'security-test';
  process.env.BASIC_AUTH_PASSWORD = 'security-test-password';
  process.env.LOGIN_MAX_ATTEMPTS_PER_IP = '100';
  process.env.LOGIN_MAX_FAILED_ATTEMPTS_PER_IP = '2';
  process.env.LOGIN_FAILED_LOCKOUT_SECONDS = '60';
  const app = require('../server');
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const generated = path.join(__dirname, '../public/generated/security-test-file.txt');
  fs.mkdirSync(path.dirname(generated), { recursive: true });
  fs.writeFileSync(generated, 'private test artifact');
  t.after(async () => {
    app.locals.videoStudio.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(generated, { force: true });
  });
  async function request(route, options = {}) {
    return fetch(base + route, { redirect: 'manual', ...options });
  }
  async function login(extra = {}, password = 'security-test-password') {
    return request('/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...extra },
      body: new URLSearchParams({ username: 'security-test', password }) });
  }
  for (const [method, route] of [['POST', '/generate'], ['GET', '/api/video/config'], ['GET', '/api/video/jobs'],
    ['POST', '/api/video/jobs'], ['POST', '/api/video/quote'], ['GET', '/api/video/jobs/unknown/file'], ['GET', '/generated/security-test-file.txt']]) {
    const response = await request(route, { method });
    assert.equal(response.status, 401, `${method} ${route} rejects anonymous requests`);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
  for (const route of ['/', '/.env', '/server.js', '/video-studio.js', '/data/video/jobs.json']) {
    const response = await request(route);
    assert.equal(response.status, 302); assert.equal(response.headers.get('location'), '/login');
  }
  const forged = await request('/api/video/config', { headers: { Cookie: 'studio_auth=' + 'a'.repeat(43) } });
  assert.equal(forged.status, 401);
  const first = await login();
  assert.equal(first.status, 302);
  assert.equal(first.headers.get('referrer-policy'), 'same-origin', 'browser form POSTs must retain their own Origin');
  const cookie = first.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Lax/);
  const session = cookie.split(';')[0];
  assert.equal((await request('/api/video/config', { headers: { Cookie: session } })).status, 200);
  const privateFile = await request('/generated/security-test-file.txt', { headers: { Cookie: session } });
  assert.equal(privateFile.status, 200); assert.equal(privateFile.headers.get('cache-control'), 'private, no-store');
  assert.equal((await request('/.env', { headers: { Cookie: session } })).status, 404);
  const second = await login();
  assert.notEqual(second.headers.get('set-cookie').split(';')[0], session);
  const crossSite = await request('/generate', { method: 'POST', headers: { Cookie: session, Origin: 'https://attacker.example' } });
  assert.equal(crossSite.status, 403);
  const crossSiteLogin = await login({ Origin: 'https://attacker.example' }); assert.equal(crossSiteLogin.status, 403);
  const opaqueOrigin = await login({ Origin: 'null' }); assert.equal(opaqueOrigin.status, 403, 'opaque cross-origin forms remain blocked');
  const browserForm = await login({ Origin: base, 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'navigate' });
  assert.equal(browserForm.status, 302); assert.ok(browserForm.headers.get('set-cookie'), 'normal browser form can log in');
  const fetchMetadata = await request('/api/video/jobs', { method: 'POST', headers: { Cookie: session, 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(fetchMetadata.status, 403);
  const sameSite = await request('/generate', { method: 'POST', headers: { Cookie: session, Origin: base } });
  assert.equal(sameSite.status, 400, 'same-origin authenticated input reaches validation, with no model call');
  await request('/logout', { method: 'POST', headers: { Cookie: session } });
  assert.equal((await request('/api/video/config', { headers: { Cookie: session } })).status, 401, 'logout invalidates copied cookie on the server');
  await login({ 'X-Forwarded-For': '198.51.100.1, 203.0.113.8' }, 'wrong');
  await login({ 'X-Forwarded-For': '198.51.100.2, 203.0.113.8' }, 'wrong');
  const locked = await login({ 'X-Forwarded-For': '198.51.100.3, 203.0.113.8' });
  assert.equal(locked.headers.get('location'), '/login?error=locked', 'changing spoofed leftmost IP does not bypass lockout');
  const health = await request('/health');
  assert.equal(health.status, 200); assert.equal(health.headers.get('x-frame-options'), 'DENY');
  assert.equal(health.headers.get('x-powered-by'), null);
});
