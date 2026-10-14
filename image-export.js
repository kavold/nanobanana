const sharp = require('sharp');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

function cleanText(value, limit) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function slug(value, limit = 70) {
  return cleanText(value, 500).toLowerCase().replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-')
    .slice(0, limit).replace(/^-+|-+$/g, '') || 'bilde';
}

function xml(value) {
  return value.replace(/[<>&"']/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[character]));
}

function buildExportMetadata(modelId, context = {}, now = new Date()) {
  const description = cleanText(context.originalPrompt || context.prompt, 8000);
  const title = cleanText(context.imageTitle, 160) || description.slice(0, 100) || 'Generert bilde';
  const keywords = [...new Set([
    ...cleanText(context.imageKeywords, 1000).split(/[,;]+/).map((word) => word.trim()).filter(Boolean),
    'AI-generert', modelId
  ])].slice(0, 40);
  const timestamp = now.toISOString();
  const xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xml(title)}</rdf:li></rdf:Alt></dc:title>
<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xml(description)}</rdf:li></rdf:Alt></dc:description>
<dc:subject><rdf:Bag>${keywords.map((word) => `<rdf:li>${xml(word)}</rdf:li>`).join('')}</rdf:Bag></dc:subject>
<xmp:CreatorTool>${xml(`Image Studio / ${modelId}`)}</xmp:CreatorTool>
<xmp:CreateDate>${timestamp}</xmp:CreateDate>
</rdf:Description></rdf:RDF></x:xmpmeta>`;
  const basename = `${slug(title)}_${timestamp.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}_${slug(modelId, 45)}_${crypto.randomBytes(4).toString('hex')}`;
  return { title, description, keywords, timestamp, basename, xmp };
}

// Replace only EXIF/XMP JPEG header segments, retaining the original compressed image.
function jpegHeader(buffer) {
  const segments = [];
  let offset = 2;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer[offset++] !== 0xff) throw new Error('Invalid JPEG header');
    while (buffer[offset] === 0xff) offset++;
    const marker = buffer[offset++];
    if (marker === 0xda || marker === 0xd9) return { segments, tail: buffer.subarray(start) };
    if (offset + 2 > buffer.length) throw new Error('Truncated JPEG header');
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) throw new Error('Invalid JPEG segment');
    const payload = buffer.subarray(offset + 2, offset + length);
    const isMetadata = marker === 0xe1 && (
      payload.subarray(0, 6).toString() === 'Exif\0\0' ||
      payload.subarray(0, 29).toString() === 'http://ns.adobe.com/xap/1.0/\0'
    );
    segments.push({ data: buffer.subarray(start, offset + length), isMetadata });
    offset += length;
  }
  throw new Error('JPEG has no image data');
}

async function saveExportImage(buffer, modelId, context, directory) {
  const metadata = buildExportMetadata(modelId, context);
  const input = await sharp(buffer).metadata();
  const format = ['png', 'jpeg', 'webp'].includes(input.format) ? input.format : 'png';
  const extension = format === 'jpeg' ? 'jpg' : format;
  const filename = `${metadata.basename}.${extension}`;
  let pipeline = sharp(buffer).keepMetadata().withXmp(metadata.xmp).withExifMerge({
    IFD0: {
      ImageDescription: `${metadata.title}\n${metadata.description}\nKeywords: ${metadata.keywords.join(', ')}`,
      Software: `Image Studio / ${modelId}`
    }
  });
  await fs.mkdir(directory, { recursive: true });
  const filepath = path.join(directory, filename);
  if (format === 'jpeg') {
    const original = jpegHeader(buffer);
    const updated = jpegHeader(await pipeline.jpeg().toBuffer());
    await fs.writeFile(filepath, Buffer.concat([
      buffer.subarray(0, 2),
      ...updated.segments.filter((segment) => segment.isMetadata).map((segment) => segment.data),
      ...original.segments.filter((segment) => !segment.isMetadata).map((segment) => segment.data),
      original.tail
    ]));
  } else {
    pipeline = format === 'webp' ? pipeline.webp({ lossless: true }) : pipeline.png();
    await pipeline.toFile(filepath);
  }
  return `/generated/${filename}`;
}

module.exports = { buildExportMetadata, saveExportImage };
