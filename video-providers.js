const fs = require('node:fs');

// Prices checked 2026-11-19. Output estimates only; the studio reserves a margin.
const VIDEO_MODELS = [
  { id: 'grok-imagine-video-1.5-lite', label: 'Grok Video Lite', provider: 'xai', key: 'XAI_API_KEY', tasks: ['text', 'image'], minDuration: 1, maxDuration: 15, ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9', '5:2'], rates: { '480p': 0.02, '720p': 0.03, '1080p': 0.14 }, audio: 'optional' },
  { id: 'grok-imagine-video-1.5', label: 'Grok Video', provider: 'xai', key: 'XAI_API_KEY', tasks: ['text', 'image'], minDuration: 1, maxDuration: 15, ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9', '5:2'], rates: { '480p': 0.08, '720p': 0.14, '1080p': 0.25 }, audio: 'optional' },
  { id: 'gemini-omni-1.2-flash', label: 'Gemini Omni Flash', provider: 'google', key: 'GOOGLE_API_KEY', tasks: ['text', 'image'], minDuration: 3, maxDuration: 15, ratios: ['16:9', '9:16'], rates: { '360p': 0.023172, '720p': 0.069504, '1080p': 0.104256, '4k': 0.208512 }, audio: 'included' },
  { id: 'kling-v3-motion', label: 'Kling V3 Motion Control', provider: 'fal', key: 'FAL_KEY', tasks: ['motion'], minDuration: 3, maxDuration: 30, ratios: ['16:9'], rates: { auto: 0.126 }, audio: 'source' }
];
const FAL_MODEL = 'fal-ai/kling-video/v3/standard/motion-control';
const safeProviderError = (status) => {
  if ([401, 403].includes(status)) return 'Leverandøren avviste tilgangen. Kontroller nøkkel og modelltilgang.';
  if (status === 402) return 'Leverandøren melder om tom saldo eller manglende betaling.';
  if (status === 429) return 'Leverandørens kapasitets- eller forbruksgrense er nådd.';
  return `Leverandørkallet feilet (HTTP ${status}). Ingen automatisk ny generering er startet.`;
};

function createProviders(readEnv, fetchImpl = fetch) {
  async function json(url, key, body, google = false) {
    const response = await fetchImpl(url, {
      method: body ? 'POST' : 'GET',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(google ? { 'x-goog-api-key': key } : { Authorization: key }) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(body ? 10 * 60 * 1000 : 30000), redirect: 'error'
    });
    if (!response.ok) throw new Error(safeProviderError(response.status));
    return response.json();
  }
  function image(job) {
    return `data:${job.imageMime};base64,${fs.readFileSync(job.imagePath).toString('base64')}`;
  }
  return {
    async submit(job) {
      const model = VIDEO_MODELS.find(m => m.id === job.model);
      const key = readEnv(model.key);
      if (!key) throw new Error('Krever tilkobling: API-nøkkel mangler.');
      if (model.provider === 'xai') {
        const data = await json('https://api.x.ai/v1/videos/generations', `Bearer ${key}`, {
          model: model.id, prompt: job.prompt, duration: job.duration,
          resolution: job.resolution || '720p', ...(job.task === 'text' ? { aspect_ratio: job.aspectRatio } : {}), generate_audio: job.audio,
          ...(job.task === 'image' ? { image: { url: image(job) } } : {})
        });
        if (!data.request_id) throw new Error('Leverandøren returnerte ikke en jobb-ID.');
        return { remoteId: data.request_id };
      }
      if (model.provider === 'fal') {
        const video = `data:${job.videoMime};base64,${fs.readFileSync(job.videoPath).toString('base64')}`;
        const data = await json(`https://queue.fal.run/${FAL_MODEL}`, `Key ${key}`, {
          image_url: image(job), video_url: video, prompt: job.prompt,
          character_orientation: 'video', keep_original_sound: job.audio
        });
        if (!data.request_id) throw new Error('Leverandøren returnerte ikke en jobb-ID.');
        return { remoteId: data.request_id };
      }
      const input = [{ type: 'text', text: job.prompt }];
      if (job.task === 'image') input.unshift({ type: 'image', mime_type: job.imageMime,
        data: fs.readFileSync(job.imagePath).toString('base64') });
      const data = await json('https://generativelanguage.googleapis.com/v1beta/interactions', key, {
        model: model.id, input,
        generation_config: { video_config: { task: job.task === 'image' ? 'image_to_video' : 'text_to_video' } },
        response_format: { type: 'video', resolution: job.resolution || '720p', duration: `${job.duration}s`, aspect_ratio: job.aspectRatio },
        store: false
      }, true);
      const output = data.steps?.filter(step => step.type === 'model_output')
        .flatMap(step => step.content || []).find(content => content.type === 'video' && content.data)
        || data.output_video;
      if (!output?.data) throw new Error('Google returnerte ikke videodata. Kontroller forbruk før et nytt forsøk.');
      return { bytes: Buffer.from(output.data, 'base64') };
    },
    async poll(job) {
      const model = VIDEO_MODELS.find(m => m.id === job.model);
      const key = readEnv(model.key);
      const id = encodeURIComponent(job.remoteId);
      if (model.provider === 'xai') {
        const data = await json(`https://api.x.ai/v1/videos/${id}`, `Bearer ${key}`);
        if (data.status === 'failed' || data.status === 'expired') throw new Error('Videogenereringen feilet eller utløp hos leverandøren.');
        if (data.status === 'done') {
          if (!data.video?.url) throw new Error('Leverandøren returnerte ikke en videofil.');
          return { url: data.video.url };
        }
        return null;
      }
      const base = `https://queue.fal.run/fal-ai/kling-video/requests/${id}`;
      const status = await json(`${base}/status`, `Key ${key}`);
      if (status.status !== 'COMPLETED') return null;
      const result = await json(base, `Key ${key}`);
      if (!result.video?.url) throw new Error('Kling returnerte ikke en videofil.');
      return { url: result.video.url };
    },
    async download(url) {
      const parsed = new URL(url);
      // Output URLs come from providers, never from a user's form.
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
          !['.x.ai', '.xai.com', '.fal.media'].some(suffix => parsed.hostname.endsWith(suffix))) {
        throw new Error('Leverandøren returnerte en ukjent nedlastingsadresse.');
      }
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(120000), redirect: 'error' });
      if (!response.ok) throw new Error('Kunne ikke laste ned resultatet.');
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 100 * 1024 * 1024) throw new Error('Videofilen overskrider grensen på 100 MB.');
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    }
  };
}

module.exports = { VIDEO_MODELS, createProviders };
