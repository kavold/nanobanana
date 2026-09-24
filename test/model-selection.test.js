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
      body: requestBody && (req.headers['content-type'] || '').includes('application/json') ? JSON.parse(requestBody) : requestBody
    });
    if (req.url === '/sample') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(Buffer.from(ONE_PIXEL_PNG, 'base64'));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const serverBase = `http://${req.headers.host}`;
    const responseBody = req.url === '/flux-2-max'
      ? { polling_url: `${serverBase}/poll` }
      : req.url === '/poll'
        ? { status: 'Ready', result: { sample: `${serverBase}/sample` } }
        : req.url.includes(':generateContent')
          ? { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: ONE_PIXEL_PNG } }] } }] }
          : { data: [{ b64_json: ONE_PIXEL_PNG }] };
    res.end(JSON.stringify(responseBody));
  });
  await listen(upstream);
  t.after(() => close(upstream));

  process.env.BASIC_AUTH_USERNAME = 'test-user';
  process.env.BASIC_AUTH_PASSWORD = 'test-password';
  process.env.GOOGLE_API_KEY = 'test-key';
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.OPENAI_API_BASE_URL = `http://127.0.0.1:${upstream.address().port}`;
  process.env.GOOGLE_API_BASE_URL = `http://127.0.0.1:${upstream.address().port}`;
  process.env.XAI_API_KEY = 'test-key';
  process.env.XAI_API_BASE_URL = `http://127.0.0.1:${upstream.address().port}`;
  process.env.BFL_API_KEY = 'test-key';
  process.env.BFL_API_BASE_URL = `http://127.0.0.1:${upstream.address().port}`;
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
    const imageCount = withReferenceImage === true ? 1 : Number(withReferenceImage) || 0;
    for (let index = 0; index < imageCount; index++) {
      form.append('images', new Blob([Buffer.from(ONE_PIXEL_PNG, 'base64')], { type: 'image/png' }), `reference-${index}.png`);
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
  assert.match(upstreamRequests[0].body.prompt, /^A test image\n\nDo not include any logo/);

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
  assert.match(openaiPrompt, /Never add visible text, numbers, labels, slogans, URLs/);
  assert.match(openaiPrompt, /No logo was selected as input/);

  const brandedGemini = await generate({ models: 'gemini-3.1-flash-lite-image', useIntuvioBrandGuidelines: 'true' });
  assert.equal(brandedGemini.response.status, 200);
  assert.equal(upstreamRequests[5].body.contents[0].parts[0].text, openaiPrompt);

  const logoFiles = {
    'wordmark-color': 'intuvio-wordmark-color.png',
    'wordmark-white': 'intuvio-wordmark-white.png',
    'mark-color': 'intuvio-mark-color.png',
    'mark-white': 'intuvio-mark-white.png'
  };
  for (const [logoId, filename] of Object.entries(logoFiles)) {
    const result = await generate({
      models: 'gemini-3.1-flash-lite-image',
      useIntuvioLogo: 'true',
      intuvioLogo: logoId
    });
    assert.equal(result.response.status, 200);
    const request = upstreamRequests.at(-1).body;
    assert.equal(request.contents[0].parts.length, 2);
    assert.match(request.contents[0].parts[0].text, /final supplied reference image is the selected/);
    assert.doesNotMatch(request.contents[0].parts[0].text, /No logo was selected as input/);
    assert.equal(request.contents[0].parts[1].inlineData.data,
      fs.readFileSync(path.join(__dirname, '..', 'public', 'brand', filename)).toString('base64'));
  }

  const logoEdit = await generate({ useIntuvioLogo: 'true', intuvioLogo: 'wordmark-color' });
  assert.equal(logoEdit.response.status, 200);
  assert.equal(upstreamRequests.at(-1).path, '/images/edits');
  assert.match(upstreamRequests.at(-1).body, /intuvio-wordmark-color\.png/);

  const xaiLogo = await generate({ models: 'grok-imagine-image-2.0', useIntuvioLogo: 'true', intuvioLogo: 'mark-color' });
  assert.equal(xaiLogo.response.status, 200);
  assert.equal(upstreamRequests.at(-1).body.model, 'grok-imagine-image-2.0');
  assert.match(upstreamRequests.at(-1).body.image.url, /^data:image\/png;base64,/);
  assert.match(upstreamRequests.at(-1).body.prompt, /selected Intuvio-logomark i farger/);

  const bflLogo = await generate({ models: 'flux-2-max', useIntuvioLogo: 'true', intuvioLogo: 'mark-white' });
  assert.equal(bflLogo.response.status, 200);
  const bflRequest = upstreamRequests.findLast((request) => request.path === '/flux-2-max');
  assert.equal(bflRequest.body.input_image,
    fs.readFileSync(path.join(__dirname, '..', 'public', 'brand', 'intuvio-mark-white.png')).toString('base64'));

  const requestCount = upstreamRequests.length;
  const invalidLogo = await generate({ useIntuvioLogo: 'true', intuvioLogo: 'unknown' });
  assert.equal(invalidLogo.response.status, 400);
  const tooManyForGrok = await generate({ models: 'grok-imagine-image-2.0', useIntuvioLogo: 'true', intuvioLogo: 'mark-color' }, 3);
  assert.equal(tooManyForGrok.response.status, 400);
  assert.equal(upstreamRequests.length, requestCount);
});
