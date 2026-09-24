const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZkAAAAASUVORK5CYII=';

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('default, exact sizes, and Lite resolution use the selected model capabilities', async (t) => {
  const upstreamRequests = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const requestBody = Buffer.concat(chunks).toString();
    upstreamRequests.push({
      path: req.url,
      body: req.headers['content-type'].includes('application/json') ? JSON.parse(requestBody) : requestBody
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.url.includes(':generateContent')
      ? { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: ONE_PIXEL_PNG } }] } }] }
      : { data: [{ b64_json: ONE_PIXEL_PNG }] }));
  });
  await listen(upstream);
  t.after(() => close(upstream));

  process.env.BASIC_AUTH_USERNAME = 'test-user';
  process.env.BASIC_AUTH_PASSWORD = 'test-password';
  process.env.GOOGLE_API_KEY = 'test-key';
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.OPENAI_API_BASE_URL = `http://127.0.0.1:${upstream.address().port}`;
  process.env.GOOGLE_API_BASE_URL = `http://127.0.0.1:${upstream.address().port}`;
  const app = require('../server');
  const server = http.createServer(app);
  await listen(server);
  t.after(() => close(server));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'username=test-user&password=test-password'
  });
  assert.equal(login.status, 302);
  const cookie = login.headers.get('set-cookie').split(';')[0];

  async function generate(fields, withReferenceImage = false) {
    const form = new FormData();
    form.set('prompt', 'A test image');
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    if (withReferenceImage) {
      form.set('images', new Blob([Buffer.from(ONE_PIXEL_PNG, 'base64')], { type: 'image/png' }), 'reference.png');
    }
    const response = await fetch(`${base}/generate`, { method: 'POST', headers: { Cookie: cookie }, body: form });
    const data = await response.json();
    if (data.image) {
      t.after(() => fs.rmSync(path.join(__dirname, '..', 'public', data.image.replace(/^\//, '')), { force: true }));
    }
    return { response, data };
  }

  const defaultResult = await generate({});
  assert.equal(defaultResult.response.status, 200);
  assert.equal(defaultResult.data.results[0].model, 'gpt-image-2.5-sunburst');
  assert.equal(upstreamRequests[0].path, '/images/generations');
  assert.equal(upstreamRequests[0].body.model, 'gpt-image-2.5-sunburst');
  assert.equal(upstreamRequests[0].body.prompt, 'A test image');

  const exactResult = await generate({
    models: 'gpt-image-2.5-flare',
    openaiSizeMode: 'exact',
    openaiWidth: '1536',
    openaiHeight: '1024'
  });
  assert.equal(exactResult.response.status, 200);
  assert.equal(upstreamRequests[1].body.model, 'gpt-image-2.5-flare');
  assert.equal(upstreamRequests[1].body.size, '1536x1024');

  const editResult = await generate({ models: 'gpt-image-2.5-sunburst' }, true);
  assert.equal(editResult.response.status, 200);
  assert.equal(upstreamRequests[2].path, '/images/edits');
  assert.match(upstreamRequests[2].body, /gpt-image-2\.5-sunburst/);

  const beforeLite = upstreamRequests.length;
  const liteResult = await generate({ models: 'gemini-3.1-flash-lite-image', resolution: '2K' });
  assert.equal(liteResult.response.status, 400);
  assert.match(liteResult.data.error, /bare 1K/);
  assert.equal(upstreamRequests.length, beforeLite);

  const validLite = await generate({ models: 'gemini-3.1-flash-lite-image', resolution: '1K' });
  assert.equal(validLite.response.status, 200);
  assert.equal(validLite.data.results[0].model, 'gemini-3.1-flash-lite-image');
  assert.match(upstreamRequests[3].path, /gemini-3\.1-flash-lite-image:generateContent/);
  assert.equal(upstreamRequests[3].body.generationConfig.imageConfig.imageSize, '1K');

  const brandedOpenAI = await generate({ useIntuvioBrandGuidelines: 'true' });
  assert.equal(brandedOpenAI.response.status, 200);
  const openaiPrompt = upstreamRequests[4].body.prompt;
  assert.match(openaiPrompt, /^A test image\n\nIntuvio Brand Guidelines/);
  for (const rule of ['Inter Tight', '#FFFFFF', '#211446', '#83AEEA', '#6C3DED', '#D4A7F4', '#A1DF83', '#EBD16A', '#EA9460', '#ED6060']) {
    assert.ok(openaiPrompt.includes(rule), `Missing brand rule: ${rule}`);
  }

  const brandedGemini = await generate({ models: 'gemini-3.1-flash-lite-image', useIntuvioBrandGuidelines: 'true' });
  assert.equal(brandedGemini.response.status, 200);
  assert.equal(upstreamRequests[5].body.contents[0].parts[0].text, openaiPrompt);
});
