const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { probeVideo, displaySize, normalizeMotionVideo } = require('../video-media');
const { createProviders } = require('../video-providers');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-media-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'performance.mp4'); fs.copyFileSync(path.join(__dirname, 'fixtures/video.mp4'), file);
  return { path: file, size: fs.statSync(file).size };
}

test('large motion uploads are compressed locally, keep duration and leave no conversion file', async t => {
  const file = fixture(t);
  // A valid short MP4 padded beyond the old upload limit exercises real FFmpeg
  // compression without adding a large binary or using any paid media service.
  fs.truncateSync(file.path, 51 * 1024 * 1024); file.size = fs.statSync(file.path).size;
  const result = await normalizeMotionVideo(file, await probeVideo(file.path));
  assert.equal(result.inputVideo.converted, true);
  assert.ok(result.inputVideo.originalBytes > 50 * 1024 * 1024);
  assert.ok(result.inputVideo.bytes < 1024 * 1024);
  assert.equal(result.info.streams.find(s => s.codec_type === 'video').codec_name, 'h264');
  assert.ok(Math.abs(Number(result.info.format.duration) - 3) < .1);
  assert.equal(fs.existsSync(`${file.path}.normalized.mp4`), false);
});

test('motion preparation handles display rotation and downsizes 1080p without cropping', async t => {
  const file = fixture(t);
  const large = `${file.path}.large.mp4`;
  execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', file.path, '-vf', 'scale=1920:1080', '-c:v', 'libx264', '-threads', '2', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', large]);
  fs.renameSync(large, file.path); file.size = fs.statSync(file.path).size;
  const normalized = await normalizeMotionVideo(file, await probeVideo(file.path));
  assert.equal(normalized.inputVideo.width, 1280); assert.equal(normalized.inputVideo.height, 720);
  assert.ok(Math.abs(normalized.inputVideo.width / normalized.inputVideo.height - 16 / 9) < .001);
  assert.deepEqual(displaySize({ width: 1920, height: 1080, side_data_list: [{ rotation: -90 }] }), { width: 1080, height: 1920 });
});

test('valid small video is preserved and compression failures leave no extra files', async t => {
  const file = fixture(t), original = fs.readFileSync(file.path);
  const info = await probeVideo(file.path);
  const kept = await normalizeMotionVideo(file, info);
  assert.equal(kept.inputVideo.converted, false); assert.deepEqual(fs.readFileSync(file.path), original);
  await assert.rejects(normalizeMotionVideo(file, { ...info, format: { ...info.format, duration: '31' } }), /3–30/);
  const force = { ...info, streams: info.streams.map(s => ({ ...s, codec_name: 'hevc' })) };
  await assert.rejects(normalizeMotionVideo(file, force, { ffmpeg: '/not-a-real-ffmpeg' }), /komprimeres/);
  assert.deepEqual(fs.readFileSync(file.path), original); assert.equal(fs.existsSync(`${file.path}.normalized.mp4`), false);
});

test('HTTP 422 identifies rejected fields without leaking returned URLs, inputs or keys', async () => {
  const provider = createProviders(() => 'private-key', async () => ({ ok: false, status: 422,
    json: async () => ({ detail: [{ loc: ['body', 'image_url'], msg: 'width must be >=340; signed https://secret.test/?token=private-key', input: 'data:image/png;base64,private-image' }] }) }));
  let error;
  try { await provider.submit({ model: 'fal-h3-turbo', task: 'text', duration: 5, resolution: '768p', aspectRatio: '16:9', audio: true }); } catch (e) { error = e; }
  assert.match(error.message, /startbildet.*HTTP 422/); assert.match(error.message, /dimensjoner/);
  for (const secret of ['private-key', 'secret.test', 'base64', 'private-image']) assert.equal(error.message.includes(secret), false);
});
