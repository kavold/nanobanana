const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const sharp = require('sharp');
const { normalizeVideoImage } = require('../video-images');

test('large video inputs over 10 MB are rotated, resized without cropping and compressed', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-video-image-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'large.jpg');
  await sharp(crypto.randomBytes(3600 * 2400 * 3), { raw: { width: 3600, height: 2400, channels: 3 } })
    .jpeg({ quality: 100 }).toFile(filePath);
  const before = fs.statSync(filePath).size;
  assert.ok(before > 10 * 1024 * 1024, 'regression: input used to be rejected at 10 MB');
  const result = await normalizeVideoImage({ path: filePath, size: before }, { resolution: '720p', aspectRatio: '16:9', followImageRatio: true });
  const metadata = await sharp(filePath).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 1080); assert.equal(metadata.height, 720);
  assert.equal(metadata.width / metadata.height, 3600 / 2400);
  assert.ok(result.bytes < 6 * 1024 * 1024); assert.ok(result.bytes < before);
});

test('portrait orientation is respected and small images are never enlarged', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-video-portrait-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'portrait.jpg');
  await sharp({ create: { width: 1200, height: 800, channels: 3, background: 'blue' } })
    .withMetadata({ orientation: 6 }).jpeg().toFile(filePath);
  const result = await normalizeVideoImage({ path: filePath, size: fs.statSync(filePath).size }, { resolution: '720p', aspectRatio: '9:16', followImageRatio: true });
  assert.equal(result.originalWidth, 800); assert.equal(result.originalHeight, 1200);
  const metadata = await sharp(filePath).metadata();
  assert.ok(metadata.height > metadata.width); assert.ok(!metadata.orientation);
  const small = path.join(directory, 'small.png');
  await sharp({ create: { width: 64, height: 32, channels: 3, background: 'white' } }).png().toFile(small);
  const unchanged = await normalizeVideoImage({ path: small, size: fs.statSync(small).size }, { resolution: '1080p', aspectRatio: '16:9', followImageRatio: false });
  assert.equal(unchanged.width, 64); assert.equal(unchanged.height, 32);
});
