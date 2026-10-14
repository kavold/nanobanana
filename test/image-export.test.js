const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { buildExportMetadata, saveExportImage } = require('../image-export');

test('names are safe, distinctive and based on the original user description', () => {
  const context = { originalPrompt: 'Rødt møterom med ærlig rådgivning', prompt: 'INTERNAL BRAND RULES', imageKeywords: 'salg, høst; salg' };
  const first = buildExportMetadata('gpt-image-2', context, new Date('2026-10-14T12:30:00Z'));
  const second = buildExportMetadata('gpt-image-2', context, new Date('2026-10-14T12:30:00Z'));
  assert.match(first.basename, /^rodt-moterom-med-aerlig-radgivning_20261014T123000Z_gpt-image-2_[a-f0-9]{8}$/);
  assert.notEqual(first.basename, second.basename);
  assert.deepEqual(first.keywords, ['salg', 'høst', 'AI-generert', 'gpt-image-2']);
  assert.ok(!first.xmp.includes('INTERNAL BRAND RULES'));
  assert.match(buildExportMetadata('model', { imageTitle: '../../CON: "Title"' }).basename, /^con-title_/);
  assert.ok(buildExportMetadata('model', {}).basename.startsWith('generert-bilde_'));
});

for (const format of ['png', 'jpeg', 'webp']) {
  test(`${format} export embeds Unicode title, prompt and keywords and retains format and dimensions`, async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'image-export-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const buffer = await sharp({ create: { width: 10, height: 8, channels: 4, background: '#83AEEA80' } }).toFormat(format).toBuffer();
    const image = await saveExportImage(buffer, 'test-model', {
      imageTitle: 'Høst & "rådgivning" <2026>',
      originalPrompt: 'Et blått møterom med norske rådgivere.',
      imageKeywords: 'møte, høst, kundedata'
    }, directory);
    const output = path.join(directory, path.basename(image));
    const metadata = await sharp(output).metadata();
    assert.equal(metadata.format, format);
    assert.equal(metadata.width, 10);
    assert.equal(metadata.height, 8);
    assert.match(image, new RegExp(`\\.${format === 'jpeg' ? 'jpg' : format}$`));
    assert.ok(metadata.exif, 'EXIF is embedded');
    assert.ok(metadata.xmp, 'XMP is embedded');
    const xmp = metadata.xmp.toString();
    assert.ok(xmp.includes('Høst &amp; &quot;rådgivning&quot; &lt;2026&gt;'));
    assert.ok(xmp.includes('Et blått møterom med norske rådgivere.'));
    assert.ok(xmp.includes('<rdf:li>kundedata</rdf:li>'));
    assert.ok(xmp.includes('Image Studio / test-model'));
    assert.deepEqual(await sharp(output).raw().toBuffer(), await sharp(buffer).raw().toBuffer());
    if (format === 'jpeg') {
      const saved = await fs.readFile(output);
      const scanMarker = Buffer.from([0xff, 0xda]);
      assert.deepEqual(saved.subarray(saved.indexOf(scanMarker)), buffer.subarray(buffer.indexOf(scanMarker)));
    } else {
      assert.equal(metadata.hasAlpha, true);
    }
  });
}
