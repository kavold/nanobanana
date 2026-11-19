const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { FAL_MODELS, VIDEO_TASKS, modelDurations, estimateVideo } = require('../video-catalogue');
const { falInput, createProviders } = require('../video-providers');
const contracts = require('./fixtures/fal-video-contracts.json').endpoints;

function checkValue(value, schema, label) {
  if (schema.anyOf) return assert.ok(schema.anyOf.some(s => { try { checkValue(value, s, label); return true; } catch { return false; } }), label);
  if (schema.type === 'string') assert.equal(typeof value, 'string', label);
  if (schema.type === 'integer') assert.ok(Number.isInteger(value), label);
  if (schema.type === 'number') assert.equal(typeof value, 'number', label);
  if (schema.type === 'boolean') assert.equal(typeof value, 'boolean', label);
  if (schema.type === 'null') assert.equal(value, null, label);
  if (schema.enum) assert.ok(schema.enum.includes(value), `${label}: ${value} not in ${schema.enum}`);
  if (schema.minimum !== undefined) assert.ok(value >= schema.minimum, label);
  if (schema.maximum !== undefined) assert.ok(value <= schema.maximum, label);
}

test('every fal adapter matches required fields, types and choices from public API schemas', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fal-contract-'));
  const file = path.join(directory, 'upload'); fs.writeFileSync(file, 'test-file');
  try {
    for (const model of FAL_MODELS) for (const task of model.tasks) {
      const inputs = VIDEO_TASKS[task].inputs;
      for (const resolution of Object.keys(model.rates)) for (const duration of modelDurations(model, resolution)) {
        const job = { task, model: model.id, prompt: 'En båt', duration, resolution, aspectRatio: '16:9', audio: true };
        for (const kind of inputs) { job[`${kind}Path`] = file; job[`${kind}Mime`] = { image: 'image/webp', audio: 'audio/wav', video: 'video/mp4' }[kind]; }
        const body = falInput(model, job), schema = contracts[model.endpoints[task]];
        for (const key of schema.required) assert.ok(Object.hasOwn(body, key), `${model.id}/${task} missing ${key}`);
        for (const [key, value] of Object.entries(body)) {
          assert.ok(Object.hasOwn(schema.properties, key), `${model.id}/${task} unknown ${key}`);
          checkValue(value, schema.properties[key], `${model.id}/${task}/${key}`);
        }
      }
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('quotes include audio surcharges, output overruns and long speech multipliers', () => {
  const model = id => FAL_MODELS.find(m => m.id === id);
  assert.equal(estimateVideo(model('fal-pixverse'), { duration: 5, resolution: '720p', audio: false }), .225);
  assert.equal(estimateVideo(model('fal-pixverse'), { duration: 5, resolution: '720p', audio: true }), .3);
  assert.equal(estimateVideo(model('fal-h3-turbo'), { duration: 5, resolution: '768p', audio: true }), .228);
  assert.equal(estimateVideo(model('fal-h3-lipsync'), { duration: 30, resolution: '768p', audio: true }), 2.88);
  assert.deepEqual(modelDurations(model('fal-veo-fast'), '1080p'), [8]);
  assert.deepEqual(modelDurations(model('fal-ltx'), '1080p'), [6, 8, 10]);
  assert.ok(estimateVideo(model('fal-seedance'), { duration: 4, resolution: '720p', audio: true, aspectRatio: '21:9' }) >
    estimateVideo(model('fal-seedance'), { duration: 4, resolution: '720p', audio: true, aspectRatio: '16:9' }));
});

test('fal queue polling uses each model family and never retries an unsuccessful POST', async () => {
  for (const model of FAL_MODELS) for (const task of model.tasks) {
    const requests = [];
    const provider = createProviders(() => 'fake', async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => url.endsWith('/status') ? { status: 'COMPLETED' } : { video: { url: 'https://v3.fal.media/out.mp4' } } };
    });
    assert.equal((await provider.poll({ model: model.id, task, remoteId: 'unique-id' })).url, 'https://v3.fal.media/out.mp4');
    const root = model.endpoints[task].split('/').slice(0, 2).join('/');
    assert.equal(requests[0].url, `https://queue.fal.run/${root}/requests/unique-id/status`);
    assert.equal(requests[1].url, `https://queue.fal.run/${root}/requests/unique-id`);
    assert.equal(requests[0].options.headers.Authorization, 'Key fake');
  }
  let calls = 0;
  const provider = createProviders(() => 'fake', async () => { calls++; return { ok: false, status: 402 }; });
  await assert.rejects(provider.submit({ model: 'fal-h3-turbo', task: 'text', prompt: 'test', resolution: '768p', duration: 5, aspectRatio: '16:9', audio: true }), /saldo/);
  assert.equal(calls, 1);
});

test('provider download blocks other storage buckets, credentials and redirects', async () => {
  let calls = 0;
  const provider = createProviders(() => '', async (url, options) => {
    calls++; assert.equal(options.headers, undefined); assert.equal(options.redirect, 'error');
    return { ok: true, body: [Buffer.from('file')] };
  });
  for (const url of ['https://storage.googleapis.com/private/secrets', 'https://storage.googleapis.com/falserverless/../secret', 'https://evil.fal.media.attacker.test/out', 'https://user:password@v3.fal.media/out']) await assert.rejects(provider.download(url), /ukjent/);
  assert.equal(calls, 0);
  assert.equal((await provider.download('https://storage.googleapis.com/falserverless/output/test.mp4')).toString(), 'file');
  assert.equal(calls, 1);
});
