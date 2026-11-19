const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { execFileSync } = require('node:child_process');
const { createVideoStudio } = require('../video-studio');
const { createProviders } = require('../video-providers');

async function setup(t, env = { XAI_API_KEY: 'fake' }, providers) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'video-studio-test-'));
  const readEnv = name => env[name] || '';
  const studio = createVideoStudio({ readEnv, directory, providers, pollMs: 1e8 });
  const app = express(); app.use('/api/video', studio.router);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/video`;
  t.after(async () => {
    studio.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { studio, directory, base, readEnv };
}
function form(extra = {}, files = {}) {
  const data = new FormData();
  const fields = { task: 'text', model: 'grok-imagine-video-1.5-lite', prompt: 'En båt på stille vann', duration: '5', aspectRatio: '16:9', audio: 'true', requestId: 'test-request-id-0001', confirmed: 'true', ...extra };
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  for (const [key, file] of Object.entries(files)) data.set(key, new Blob([file.bytes], { type: file.type }), file.name);
  return data;
}
async function post(base, endpoint, data) {
  const response = await fetch(`${base}/${endpoint}`, { method: 'POST', body: data });
  return { status: response.status, data: await response.json() };
}

test('duplicate submissions, authenticated file handling and persisted history avoid repeat generation', async t => {
  let calls = 0;
  const s = await setup(t, { XAI_API_KEY: 'fake' }, {
    submit: async () => { calls++; return { remoteId: 'test-remote' }; },
    poll: async () => ({ bytes: fs.readFileSync(path.join(__dirname, 'fixtures/video.mp4')) })
  });
  const quote = await post(s.base, 'quote', form());
  assert.equal(quote.status, 200);
  const first = await post(s.base, 'jobs', form());
  assert.equal(first.status, 202);
  const duplicate = await post(s.base, 'jobs', form());
  assert.equal(duplicate.status, 200); assert.equal(duplicate.data.id, first.data.id);
  const changed = await post(s.base, 'jobs', form({ prompt: 'Annet motiv' }));
  assert.equal(changed.status, 400);
  await s.studio.tick();
  const listing = await (await fetch(`${s.base}/jobs`)).json();
  assert.equal(listing.jobs.length, 1); assert.equal(listing.jobs[0].status, 'completed');
  assert.equal(calls, 1); assert.ok(listing.reservedTodayUsd > 0);
  assert.equal(JSON.stringify(listing).includes('imagePath'), false);
  const video = await fetch(`${s.base}/jobs/${first.data.id}/file`);
  assert.equal(video.status, 200); assert.match(video.headers.get('content-type'), /video\/mp4/);
  const range = await fetch(`${s.base}/jobs/${first.data.id}/file`, { headers: { Range: 'bytes=0-31' } });
  assert.equal(range.status, 206);
  s.studio.close();
  const restarted = createVideoStudio({ readEnv: s.readEnv, directory: s.directory, pollMs: 1e8 });
  t.after(() => restarted.close());
  assert.equal(JSON.parse(fs.readFileSync(path.join(s.directory, 'jobs.json')))[0].status, 'completed');
});

test('server enforces missing keys, per-job/day budget, validation and origin', async t => {
  const s = await setup(t, { XAI_API_KEY: 'fake', VIDEO_MAX_JOB_USD: '0.1' });
  assert.equal((await post(s.base, 'jobs', form())).status, 400);
  assert.equal((await post(s.base, 'quote', form({ duration: '999' }))).status, 400);
  assert.equal((await post(s.base, 'quote', form({ task: 'motion' }))).status, 400);
  const origin = await fetch(`${s.base}/jobs`, { method: 'POST', headers: { Origin: 'https://evil.example' }, body: form() });
  assert.equal(origin.status, 403);
  const noLive = await setup(t, {});
  assert.equal((await post(noLive.base, 'jobs', form())).status, 400);
  const day = await setup(t, { XAI_API_KEY: 'fake', VIDEO_MAX_DAY_USD: '0.1' });
  assert.equal((await post(day.base, 'jobs', form())).status, 400);
});

test('persisted remote IDs resume polling; uncertain submissions never repeat', async t => {
  let submits = 0; let polls = 0;
  const s = await setup(t, { XAI_API_KEY: 'fake' }, {
    submit: async () => { submits++; return { remoteId: 'remote-1' }; },
    poll: async () => { polls++; return { bytes: fs.readFileSync(path.join(__dirname, 'fixtures/video.mp4')) }; }
  });
  assert.equal((await post(s.base, 'jobs', form())).status, 202);
  // Submission happens immediately after the response is sent.
  for (let i = 0; i < 20 && !JSON.parse(fs.readFileSync(path.join(s.directory, 'jobs.json')))[0].remoteId; i++) await new Promise(r => setTimeout(r, 5));
  s.studio.close();
  const resumed = createVideoStudio({ readEnv: s.readEnv, directory: s.directory, pollMs: 1e8, providers: {
    submit: async () => { submits++; }, poll: async () => { polls++; return { bytes: fs.readFileSync(path.join(__dirname, 'fixtures/video.mp4')) }; }
  } });
  t.after(() => resumed.close()); await resumed.tick();
  assert.equal(submits, 1); assert.equal(polls, 1);
  const jobs = JSON.parse(fs.readFileSync(path.join(s.directory, 'jobs.json')));
  jobs[0].status = 'submitting'; delete jobs[0].remoteId;
  fs.writeFileSync(path.join(s.directory, 'jobs.json'), JSON.stringify(jobs));
  const uncertain = createVideoStudio({ readEnv: s.readEnv, directory: s.directory, pollMs: 1e8 });
  t.after(() => uncertain.close());
  assert.equal(JSON.parse(fs.readFileSync(path.join(s.directory, 'jobs.json')))[0].status, 'attention');
  assert.ok(uncertain.catalogue().reservedTodayUsd > 0);
});

test('Kling quote measures the video server-side and rejects fake images', async t => {
  try { execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }); } catch { t.skip('ffprobe is not installed'); return; }
  const s = await setup(t);
  const image = await require('sharp')({ create: { width: 64, height: 64, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const fields = { task: 'motion', model: 'kling-v3-motion', duration: '1' };
  const files = {
    image: { bytes: image, type: 'image/png', name: 'figure.png' },
    video: { bytes: fs.readFileSync(path.join(__dirname, 'fixtures/video.mp4')), type: 'video/mp4', name: 'performance.mp4' }
  };
  const quote = await post(s.base, 'quote', form(fields, files));
  assert.equal(quote.status, 200); assert.equal(quote.data.duration, 3);
  assert.ok(quote.data.estimate >= 3 * 0.126);
  assert.equal((await post(s.base, 'quote', form(fields, { ...files, image: { bytes: 'not an image', name: 'fake.png', type: 'image/png' } }))).status, 400);
  assert.equal(fs.readdirSync(s.directory).length, 1, 'temporary uploads are cleaned');
});

test('provider contracts map uploads, audio, remote IDs and Google inline output', async () => {
  const requests = [];
  const fakeFetch = async (url, options) => {
    requests.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
    return { ok: true, json: async () => url.includes('interactions') ? { output_video: { data: 'dmlkZW8=' } } : { request_id: 'remote-123' } };
  };
  const provider = createProviders(() => 'test-key', fakeFetch);
  const imagePath = path.join(os.tmpdir(), `video-provider-${Date.now()}.png`); fs.writeFileSync(imagePath, 'image');
  try {
    const job = { model: 'grok-imagine-video-1.5-lite', task: 'image', prompt: 'Animate', duration: 5, aspectRatio: '16:9', audio: false, imagePath, imageMime: 'image/png' };
    assert.equal((await provider.submit(job)).remoteId, 'remote-123');
    assert.match(requests[0].body.image.url, /^data:image\/png;base64,/);
    assert.equal(requests[0].body.aspect_ratio, undefined, 'xAI image ratio comes from the image, not an unsupported pixel ratio');
    assert.equal(requests[0].body.generate_audio, false);
    const google = await provider.submit({ ...job, model: 'gemini-omni-1.2-flash', audio: true });
    assert.equal(google.bytes.toString(), 'video');
    assert.equal(requests[1].body.response_format.duration, '5s');
    assert.equal(requests[1].body.generation_config.video_config.task, 'image_to_video');
    await provider.submit({ ...job, model: 'kling-v3-motion', task: 'motion', videoPath: imagePath, videoMime: 'video/mp4' });
    assert.equal(requests[2].body.character_orientation, 'video');
    assert.equal(requests[2].body.keep_original_sound, false);
    assert.equal(requests[2].options.headers.Authorization, 'Key test-key');
    await assert.rejects(provider.download('http://127.0.0.1/private'), /ukjent/);
  } finally { fs.rmSync(imagePath); }
});

test('video API and downloads require the existing app login', async t => {
  process.env.BASIC_AUTH_USERNAME = 'test-user'; process.env.BASIC_AUTH_PASSWORD = 'test-password';
  process.env.XAI_API_KEY = 'fake';
  const app = require('../server');
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { app.locals.videoStudio.close(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/api/video/config`)).status, 401);
  assert.equal((await fetch(`${base}/api/video/jobs/not-a-real-id/file`)).status, 401);
  const login = await fetch(`${base}/login`, { method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'username=test-user&password=test-password' });
  assert.equal(login.status, 302);
  const headers = { Cookie: login.headers.get('set-cookie').split(';')[0] };
  const config = await (await fetch(`${base}/api/video/config`, { headers })).json();
  assert.equal(config.demo, undefined); assert.equal(config.models.length, 4);
  assert.equal(JSON.stringify(config).includes('test-password'), false);
  const html = await (await fetch(base, { headers })).text();
  for (const id of ['imagesPanel', 'videoPanel', 'videoForm', 'videoQuote', 'videoJobs']) assert.ok(html.includes(`id="${id}"`));
  assert.ok(html.includes('data-animate-video'));
  const vm = require('node:vm');
  for (const script of [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]) new vm.Script(script[1]);
  const js = await (await fetch(`${base}/video-studio.js`, { headers })).text();
  new vm.Script(js);
});
