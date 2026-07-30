const fs = require('fs');
const path = require('path');
const convertHeic = require('heic-convert');
const sharp = require('sharp');

const DEFAULT_MAX_EDGE = 2048;
const DEFAULT_MAX_TOTAL_BYTES = 14 * 1024 * 1024;
const DEFAULT_MAX_FILE_BYTES = 20 * 1024 * 1024;
const WEBP_QUALITIES = [88, 80, 72, 64, 56, 48, 40];
const MIN_EDGE = 768;

function normalizedOriginalName(originalName) {
  const parsed = path.parse(originalName || 'image');
  return `${parsed.name || 'image'}.webp`;
}

function isHeicFile(file) {
  const mimeType = String(file.mimetype || '').toLowerCase();
  const extension = path.extname(file.originalname || '').toLowerCase();
  return mimeType === 'image/heic'
    || mimeType === 'image/heif'
    || extension === '.heic'
    || extension === '.heif';
}

async function prepareInputPath(file) {
  if (!isHeicFile(file)) {
    return { sourcePath: file.path, temporaryPath: null };
  }

  const temporaryPath = `${file.path}.heic-converted.jpg`;
  const convertedBuffer = await convertHeic({
    buffer: fs.readFileSync(file.path),
    format: 'JPEG',
    quality: 0.92
  });
  fs.writeFileSync(temporaryPath, convertedBuffer);
  return { sourcePath: temporaryPath, temporaryPath };
}

async function encodeWithinTarget(filePath, maxBytes, maxEdge) {
  let edge = maxEdge;
  let smallestBuffer = null;

  while (edge >= MIN_EDGE) {
    const pipeline = sharp(filePath, {
      failOn: 'warning',
      limitInputPixels: 100_000_000
    })
      .rotate()
      .resize({
        width: edge,
        height: edge,
        fit: 'inside',
        withoutEnlargement: true
      });

    for (const quality of WEBP_QUALITIES) {
      const buffer = await pipeline.clone().webp({
        quality,
        effort: 4,
        smartSubsample: true
      }).toBuffer();

      if (!smallestBuffer || buffer.length < smallestBuffer.length) {
        smallestBuffer = buffer;
      }
      if (buffer.length <= maxBytes) {
        return buffer;
      }
    }

    edge = Math.floor(edge * 0.75);
  }

  if (smallestBuffer && smallestBuffer.length <= maxBytes) {
    return smallestBuffer;
  }
  throw new Error(`Bildet kunne ikke komprimeres til ${(maxBytes / (1024 * 1024)).toFixed(2)} MB.`);
}

async function normalizeUploadedImages(files, options = {}) {
  if (!Array.isArray(files) || files.length === 0) {
    return {
      processedFiles: 0,
      totalBeforeBytes: 0,
      totalAfterBytes: 0
    };
  }

  const maxEdge = options.maxEdge || DEFAULT_MAX_EDGE;
  const maxTotalBytes = options.maxTotalBytes || DEFAULT_MAX_TOTAL_BYTES;
  const maxFileBytes = options.maxFileBytes || DEFAULT_MAX_FILE_BYTES;
  const perFileTarget = Math.min(maxFileBytes, Math.floor(maxTotalBytes / files.length));
  let totalBeforeBytes = 0;
  let totalAfterBytes = 0;

  for (const file of files) {
    const beforeBytes = file.size || fs.statSync(file.path).size;
    totalBeforeBytes += beforeBytes;

    let normalizedBuffer;
    let preparedInput = null;
    try {
      preparedInput = await prepareInputPath(file);
      normalizedBuffer = await encodeWithinTarget(preparedInput.sourcePath, perFileTarget, maxEdge);
    } catch (error) {
      const name = file.originalname || file.filename || 'ukjent fil';
      throw new Error(`Kunne ikke behandle "${name}" som bilde: ${error.message}`);
    } finally {
      if (preparedInput && preparedInput.temporaryPath && fs.existsSync(preparedInput.temporaryPath)) {
        fs.unlinkSync(preparedInput.temporaryPath);
      }
    }

    const temporaryPath = `${file.path}.normalized`;
    try {
      fs.writeFileSync(temporaryPath, normalizedBuffer);
      fs.renameSync(temporaryPath, file.path);
    } finally {
      if (fs.existsSync(temporaryPath)) {
        fs.unlinkSync(temporaryPath);
      }
    }

    file.size = normalizedBuffer.length;
    file.mimetype = 'image/webp';
    file.originalname = normalizedOriginalName(file.originalname);
    totalAfterBytes += normalizedBuffer.length;
  }

  return {
    processedFiles: files.length,
    totalBeforeBytes,
    totalAfterBytes
  };
}

module.exports = {
  normalizeUploadedImages
};
