const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildXaiImageRequest,
  requestXaiImage,
  resolveXaiAspectRatio,
  resolveXaiResolution
} = require('../xai-image');

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

test('maps shared size choices to values supported by Grok Imagine', () => {
  assert.equal(resolveXaiAspectRatio('16:9'), '16:9');
  assert.equal(resolveXaiAspectRatio('4:5'), '3:4');
  assert.equal(resolveXaiAspectRatio('21:9'), '20:9');
  assert.equal(resolveXaiAspectRatio('invalid'), '16:9');
  assert.equal(resolveXaiResolution('1K'), '1k');
  assert.equal(resolveXaiResolution('2K'), '2k');
  assert.equal(resolveXaiResolution('4K'), '2k');
  assert.equal(resolveXaiResolution('invalid'), '1k');
});

test('builds a Grok generation request with no input image', () => {
  const request = buildXaiImageRequest({
    modelId: 'grok-imagine-image-2.0',
    prompt: 'Nordlys over Oslo',
    files: [],
    aspectRatio: '16:9',
    resolution: '2K'
  });

  assert.equal(request.pathname, '/images/generations');
  assert.deepEqual(request.payload, {
    model: 'grok-imagine-image-2.0',
    prompt: 'Nordlys over Oslo',
    aspect_ratio: '16:9',
    resolution: '2k',
    quality: 'medium',
    response_format: 'b64_json'
  });
});

test('rejects more than three Grok reference images before reading files', () => {
  assert.throws(() => buildXaiImageRequest({
    modelId: 'grok-imagine-image-2.0',
    prompt: 'Et motiv',
    files: Array.from({ length: 4 }, () => ({ path: '/not-read.webp', mimetype: 'image/webp' })),
    aspectRatio: '1:1',
    resolution: '1K'
  }), /maks 3 referansebilder/);
});

test('sends reference images as data URLs to the Grok edit endpoint', (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'xai-image-test-'));
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  const firstPath = path.join(temporaryDirectory, 'first.webp');
  const secondPath = path.join(temporaryDirectory, 'second.webp');
  fs.writeFileSync(firstPath, Buffer.from('first'));
  fs.writeFileSync(secondPath, Buffer.from('second'));

  const request = buildXaiImageRequest({
    modelId: 'grok-imagine-image-2.0',
    prompt: 'Slå sammen motivene',
    files: [
      { path: firstPath, mimetype: 'image/webp' },
      { path: secondPath, mimetype: 'image/webp' }
    ],
    aspectRatio: '3:2',
    resolution: '1K'
  });

  assert.equal(request.pathname, '/images/edits');
  assert.equal(request.payload.images.length, 2);
  assert.match(request.payload.images[0].url, /^data:image\/webp;base64,/);
  assert.equal(request.payload.image, undefined);
});

test('decodes a base64 Grok response and exposes request metadata', async () => {
  let capturedUrl = '';
  let capturedOptions = null;
  const fetchImpl = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return jsonResponse({
      data: [{
        b64_json: Buffer.from('generated-image').toString('base64'),
        mime_type: 'image/jpeg',
        revised_prompt: 'Forbedret prompt'
      }],
      usage: { cost_in_usd_ticks: 400000000 }
    });
  };

  const result = await requestXaiImage({
    apiKey: 'test-key',
    baseUrl: 'https://api.x.ai/v1/',
    modelId: 'grok-imagine-image-2.0',
    prompt: 'Et motiv',
    files: [],
    aspectRatio: '1:1',
    resolution: '2K',
    fetchImpl
  });

  assert.equal(capturedUrl, 'https://api.x.ai/v1/images/generations');
  assert.equal(capturedOptions.headers.Authorization, 'Bearer test-key');
  assert.deepEqual(result.imageBuffer, Buffer.from('generated-image'));
  assert.equal(result.contentType, 'image/jpeg');
  assert.equal(result.revisedPrompt, 'Forbedret prompt');
  assert.deepEqual(result.usage, { cost_in_usd_ticks: 400000000 });
});

test('surfaces the xAI API error message', async () => {
  const fetchImpl = async () => jsonResponse({
    error: { message: 'Invalid API key' }
  }, 401);

  await assert.rejects(
    requestXaiImage({
      apiKey: 'bad-key',
      baseUrl: 'https://api.x.ai/v1',
      modelId: 'grok-imagine-image-2.0',
      prompt: 'Et motiv',
      files: [],
      aspectRatio: '1:1',
      resolution: '1K',
      fetchImpl
    }),
    /Invalid API key/
  );
});
