const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const sharp = require('sharp');
const { normalizeUploadedImages } = require('../image-processing');

async function createNoisyJpeg(filePath, width, height) {
  const pixels = crypto.randomBytes(width * height * 3);
  await sharp(pixels, {
    raw: { width, height, channels: 3 }
  }).jpeg({ quality: 100 }).toFile(filePath);
}

test('normalizes a large mobile-style image before model input', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nano-banana-image-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const filePath = path.join(directory, 'mobile.jpg');
  await createNoisyJpeg(filePath, 5000, 3500);
  const beforeBytes = fs.statSync(filePath).size;
  const files = [{
    path: filePath,
    size: beforeBytes,
    mimetype: 'image/jpeg',
    originalname: 'mobile.jpg'
  }];

  const stats = await normalizeUploadedImages(files, {
    maxEdge: 2048,
    maxTotalBytes: 14 * 1024 * 1024,
    maxFileBytes: 20 * 1024 * 1024
  });
  const metadata = await sharp(filePath).metadata();

  assert.ok(beforeBytes > 7 * 1024 * 1024);
  assert.ok(files[0].size < beforeBytes);
  assert.ok(files[0].size <= 14 * 1024 * 1024);
  assert.equal(files[0].mimetype, 'image/webp');
  assert.equal(files[0].originalname, 'mobile.webp');
  assert.equal(metadata.format, 'webp');
  assert.ok(Math.max(metadata.width, metadata.height) <= 2048);
  assert.equal(stats.totalAfterBytes, files[0].size);
});

test('shares the total byte budget across all images', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nano-banana-images-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const paths = [path.join(directory, 'one.jpg'), path.join(directory, 'two.jpg')];
  await Promise.all(paths.map((filePath) => createNoisyJpeg(filePath, 1400, 1000)));
  const files = paths.map((filePath, index) => ({
    path: filePath,
    size: fs.statSync(filePath).size,
    mimetype: 'image/jpeg',
    originalname: `${index + 1}.jpg`
  }));
  const maxTotalBytes = 700 * 1024;

  const stats = await normalizeUploadedImages(files, {
    maxEdge: 1200,
    maxTotalBytes,
    maxFileBytes: 20 * 1024 * 1024
  });

  assert.ok(stats.totalAfterBytes <= maxTotalBytes);
  assert.ok(files.every((file) => file.size <= maxTotalBytes / files.length));
});
