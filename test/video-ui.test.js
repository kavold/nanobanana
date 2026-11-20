const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { VIDEO_MODELS } = require('../video-providers');
const { VIDEO_TASKS } = require('../video-catalogue');
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };

async function ui(t) {
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8'), { url: 'https://studio.test', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window, $ = id => w.document.getElementById(id), requests = [];
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.URL.createObjectURL = () => 'blob:preview'; w.URL.revokeObjectURL = () => {};
  w.crypto.randomUUID = require('node:crypto').randomUUID;
  const config = { tasks: VIDEO_TASKS, maxDayUsd: 10, maxJobUsd: 3,
    models: VIDEO_MODELS.map(({ key, ...m }) => ({ ...m, available: true, connected: m.provider === 'fal' })) };
  w.fetch = async (url, options) => {
    requests.push({ url, options });
    const data = url.endsWith('/config') ? config : url.endsWith('/exchange-rate') ? { date: '2026-11-19', nokPerUsd: 9.6866 } : url.endsWith('/jobs') ? { jobs: [], reservedTodayUsd: 0 } : { estimate: .3, reserved: .425, duration: 5, aspectRatio: '16:9', resolution: '720p', priceDate: '2026-11-19' };
    return { ok: true, status: 200, json: async () => data, blob: async () => new w.Blob(['image'], { type: 'image/png' }) };
  };
  w.eval(fs.readFileSync(path.join(__dirname, '../public/video-studio.js'), 'utf8'));
  await settle();
  function task(value) { const el = w.document.querySelector(`input[name="videoTask"][value="${value}"]`); el.checked = true; el.dispatchEvent(new w.Event('change', { bubbles: true })); }
  function model(value) { $('videoModel').value = value; $('videoModel').dispatchEvent(new w.Event('change')); }
  return { w, $, requests, task, model };
}

test('task-first UI offers only compatible models and shows the correct inputs for all seven tasks', async t => {
  const s = await ui(t);
  assert.equal(s.$('videoModel').value, 'fal-kling-v3');
  s.$('videoPriority').value = 'budget'; s.$('videoPriority').dispatchEvent(new s.w.Event('change'));
  assert.equal(s.$('videoModel').value, 'fal-h3-turbo');
  for (const [value, info] of Object.entries(VIDEO_TASKS)) {
    s.task(value);
    for (const option of s.$('videoModel').options) assert.ok(VIDEO_MODELS.find(m => m.id === option.value).tasks.includes(value));
    assert.equal(s.$('videoImageGroup').hidden, !info.inputs.includes('image'));
    assert.equal(s.$('videoReferenceGroup').hidden, !info.inputs.includes('video'));
    assert.equal(s.$('videoAudioGroup').hidden, !info.inputs.includes('audio'));
    assert.equal(s.$('videoDurationGroup').hidden, Boolean(info.measured));
    assert.equal(s.$('videoPrompt').required, Boolean(info.promptRequired));
    assert.ok(s.$('videoRecommendations').children.length > 0);
  }
  assert.equal(s.requests.some(r => r.options?.method === 'POST'), false, 'choosing tasks/models never spends credits');
});

test('UI changes duration with resolution, handles fixed audio and exposes provider/limits', async t => {
  const s = await ui(t);
  s.model('fal-veo-fast');
  assert.deepEqual([...s.$('videoDuration').options].map(o => o.value), ['4', '6', '8']);
  s.$('videoResolution').value = '1080p'; s.$('videoResolution').dispatchEvent(new s.w.Event('change'));
  assert.deepEqual([...s.$('videoDuration').options].map(o => o.value), ['8']);
  s.model('fal-ltx');
  assert.deepEqual([...s.$('videoDuration').options].map(o => o.value), ['6', '8', '10']);
  s.task('image'); s.model('fal-kling-v3');
  assert.equal(s.$('videoRatioGroup').hidden, true);
  assert.match(s.$('videoModelGuide').textContent, /engelsk/);
  assert.match(s.$('videoModelHelp').textContent, /fal-saldo/);
  s.model('fal-omni'); assert.equal(s.$('videoAudio').disabled, true);
  s.model('grok-imagine-video-1.5-lite'); assert.match(s.$('videoModelHelp').textContent, /direkte xAI-saldo/);
});

test('image creation bridge returns to the original motion task with video and settings intact', async t => {
  const s = await ui(t);
  s.task('motion'); s.model('fal-kling-motion-pro');
  const video = new s.w.File(['video'], 'performance.mp4', { type: 'video/mp4' });
  Object.defineProperty(s.$('videoReference'), 'files', { value: [video] });
  s.$('videoPrompt').value = 'Superhelten følger meg';
  s.$('videoCreateImage').click();
  assert.equal(s.$('videoImageBridge').hidden, false);
  const result = s.w.document.createElement('button'); result.dataset.animateVideo = '/generated/superhero.png'; s.w.document.body.append(result);
  result.click(); await settle();
  assert.equal(s.$('videoPanel').hidden, false);
  assert.equal(s.$('videoModel').value, 'fal-kling-motion-pro');
  assert.equal(s.w.document.querySelector('input[name="videoTask"]:checked').value, 'motion');
  assert.equal(s.$('videoReference').files[0], video);
  assert.equal(s.$('videoPrompt').value, 'Superhelten følger meg');
  assert.equal(s.$('videoImagePreview').hidden, false);
  assert.equal(s.$('videoImageBridge').hidden, true);
});

test('quote form sends audio/image for a talking portrait and omits leftover video inputs', async t => {
  const s = await ui(t);
  s.task('talk'); s.model('fal-kling-avatar');
  const audio = new s.w.File(['audio'], 'speech.wav', { type: 'audio/wav' });
  const image = new s.w.File(['image'], 'portrait.png', { type: 'image/png' });
  Object.defineProperty(s.$('videoAudioFile'), 'files', { value: [audio] });
  Object.defineProperty(s.$('videoImage'), 'files', { value: [image] });
  Object.defineProperty(s.$('videoReference'), 'files', { value: [new s.w.File(['video'], 'old.mp4')] });
  s.$('videoImage').dispatchEvent(new s.w.Event('change'));
  s.$('videoForm').dispatchEvent(new s.w.Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  const request = s.requests.find(r => r.url.endsWith('/quote'));
  assert.ok(request); const data = request.options.body;
  assert.equal(data.get('task'), 'talk');
  assert.equal(data.get('speech').name, 'speech.wav');
  assert.equal(data.get('audio'), 'true');
  assert.equal(data.get('image').name, 'portrait.png');
  assert.equal(data.has('video'), false);
  assert.equal(s.$('videoQuote').hidden, false);
  assert.match(s.$('videoQuoteTitle').textContent, /2,91.*\$0\.30/);
});
