const assert = require('node:assert/strict');
const test = require('node:test');
const sharp = require('sharp');
const { describeImage, prepareImageExport } = require('../image-description');

const sample = () => sharp({ create: { width: 1400, height: 800, channels: 3, background: '#ffffff' } }).png().toBuffer();
const aiData = { title: 'Webinar om markedsplan', description: 'Annonse for et gratis webinar om markedsplan.', keywords: ['webinar', 'markedsplan', 'webinar'] };

test('AI sees the finished image preview and returns structured Norwegian metadata', async () => {
  const buffer = await sample();
  const client = { models: { generateContent: async (request) => {
    assert.equal(request.model, 'gemini-3.1-flash-lite');
    assert.ok(request.config.abortSignal);
    assert.match(request.config.systemInstruction, /norsk bokmål/);
    const preview = await sharp(Buffer.from(request.contents[0].parts[1].inlineData.data, 'base64')).metadata();
    assert.equal(preview.format, 'jpeg');
    assert.equal(preview.width, 1024);
    return { text: JSON.stringify(aiData) };
  } } };
  const result = await describeImage(buffer, client);
  assert.equal(result.imageTitle, aiData.title);
  assert.equal(result.imageDescription, aiData.description);
  assert.equal(result.imageKeywords, 'webinar, markedsplan');
});

test('manual title overrides AI title while AI description and combined keywords are saved', async () => {
  const buffer = await sample();
  const result = await prepareImageExport(buffer, 'image-model', { imageTitle: 'Min kampanje', imageKeywords: 'Intuvio' }, {
    client: { models: { generateContent: async () => ({ text: JSON.stringify(aiData) }) } },
    save: async (savedBuffer, model, metadata) => {
      assert.equal(savedBuffer, buffer);
      assert.equal(model, 'image-model');
      assert.equal(metadata.imageTitle, 'Min kampanje');
      assert.equal(metadata.imageDescription, aiData.description);
      assert.equal(metadata.imageKeywords, 'webinar, markedsplan, Intuvio');
      return '/generated/min-kampanje.png';
    }
  });
  assert.equal(result.metadataWarning, null);
});

for (const response of [null, '{"title":"","description":"bad","keywords":[]}', 'not JSON']) {
  test(`metadata failure preserves download and never names the image after the editing prompt: ${response}`, async () => {
    const result = await prepareImageExport(await sample(), 'image-model', { originalPrompt: 'Tilpass og legg på tekst' }, {
      client: { models: { generateContent: async () => {
        if (response === null) throw new Error('upstream unavailable');
        return { text: response };
      } } },
      save: async (_, __, metadata) => {
        assert.equal(metadata.imageTitle, 'Generert bilde');
        assert.equal(metadata.imageDescription, 'AI-generert bilde.');
        return '/generated/generert-bilde.png';
      }
    });
    assert.ok(result.image);
    assert.match(result.metadataWarning, /AI-navngivning feilet/);
  });
}
