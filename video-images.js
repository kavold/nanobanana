const fs = require('node:fs');
const sharp = require('sharp');

async function normalizeVideoImage(file, { resolution, aspectRatio, followImageRatio, videoSize, minimumEdge = 0 }) {
  const image = sharp(file.path, { limitInputPixels: 100_000_000, failOn: 'warning' });
  const meta = await image.metadata();
  if (!['jpeg', 'png', 'webp'].includes(meta.format)) throw new Error('Bruk et bilde i PNG, JPG eller WebP.');
  const swapped = meta.orientation >= 5 && meta.orientation <= 8;
  const originalWidth = swapped ? meta.height : meta.width;
  const originalHeight = swapped ? meta.width : meta.height;
  const shortEdge = { '360p': 360, '480p': 480, '540p': 540, '720p': 720, '768p': 768, '1080p': 1080, '1440p': 1440, '2160p': 2160, '4k': 2160, auto: 720 }[resolution];
  const ratio = followImageRatio || videoSize ? originalWidth / originalHeight
    : aspectRatio.split(':').map(Number).reduce((a, b) => a / b);
  let width = Math.round(ratio >= 1 ? shortEdge * ratio : shortEdge);
  let height = Math.round(ratio >= 1 ? shortEdge : shortEdge / ratio);
  if (videoSize) { width = videoSize.width; height = videoSize.height; }
  // A portrait need not match a landscape reference video's dimensions. Avoid
  // shrinking a valid character image below a model's minimum short edge.
  if (Math.min(originalWidth, originalHeight) >= minimumEdge && minimumEdge > 0) {
    const minimumScale = minimumEdge / Math.min(originalWidth, originalHeight);
    width = Math.max(width, Math.round(originalWidth * minimumScale));
    height = Math.max(height, Math.round(originalHeight * minimumScale));
  }
  const cap = Math.min(1, 3840 / Math.max(width, height));
  const target = { width: Math.max(1, Math.round(width * cap)), height: Math.max(1, Math.round(height * cap)), fit: 'inside', withoutEnlargement: true };
  const pipeline = image.rotate().resize(target);
  let encoded;
  for (const quality of [90, 80, 68, 52]) {
    encoded = await pipeline.clone().webp({ quality, effort: 3 }).toBuffer({ resolveWithObject: true });
    if (encoded.data.length <= 6 * 1024 * 1024) break;
  }
  if (encoded.data.length > 6 * 1024 * 1024) throw new Error('Bildet kunne ikke komprimeres til en trygg størrelse. Prøv et annet bilde.');
  fs.writeFileSync(file.path, encoded.data, { mode: 0o600 });
  return { originalWidth, originalHeight, originalBytes: file.size,
    width: encoded.info.width, height: encoded.info.height, bytes: encoded.data.length };
}

module.exports = { normalizeVideoImage };
