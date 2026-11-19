const fs = require('node:fs');
const { FAL_MODELS } = require('./video-catalogue');

// Prices checked 2026-11-19. Output estimates only; the studio reserves a margin.
const VIDEO_MODELS = [
  { id: 'grok-imagine-video-1.5-lite', label: 'Grok Video Lite', provider: 'xai', key: 'XAI_API_KEY', tasks: ['text', 'image'], minDuration: 1, maxDuration: 15, ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9', '5:2'], rates: { '480p': 0.02, '720p': 0.03, '1080p': 0.14 }, audio: 'optional' },
  { id: 'grok-imagine-video-1.5', label: 'Grok Video', provider: 'xai', key: 'XAI_API_KEY', tasks: ['text', 'image'], minDuration: 1, maxDuration: 15, ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9', '5:2'], rates: { '480p': 0.08, '720p': 0.14, '1080p': 0.25 }, audio: 'optional' },
  { id: 'gemini-omni-1.2-flash', label: 'Gemini Omni Flash', provider: 'google', key: 'GOOGLE_API_KEY', tasks: ['text', 'image'], minDuration: 3, maxDuration: 15, ratios: ['16:9', '9:16'], rates: { '360p': 0.023172, '720p': 0.069504, '1080p': 0.104256, '4k': 0.208512 }, audio: 'included' },
  ...FAL_MODELS
];

function falInput(model, job) {
  const body = { ...(model.defaults || {}) };
  const file = (kind) => `data:${job[`${kind}Mime`]};base64,${fs.readFileSync(job[`${kind}Path`]).toString('base64')}`;
  if (!['lipsync', 'upscale'].includes(job.task) && model.id !== 'fal-h3-lipsync') body.prompt = job.prompt || '.';
  if (['text', 'image'].includes(job.task)) {
    body.duration = model.id === 'fal-veo-fast' ? `${job.duration}s` : model.durationString ? String(job.duration) : job.duration;
    if (job.resolution !== 'auto') body.resolution = model.resolutionMap?.[job.resolution] || job.resolution;
    if (job.task === 'text' || !model.followImage) body.aspect_ratio = job.aspectRatio;
    if (model.audio === 'optional') body[model.audioField || 'generate_audio'] = job.audio;
  }
  if (job.imagePath) body[model.imageField || 'image_url'] = file('image');
  if (job.videoPath) body.video_url = file('video');
  if (job.audioPath) body.audio_url = file('audio');
  if (job.task === 'motion') { body.character_orientation = 'video'; body.keep_original_sound = job.audio; }
  if (job.task === 'edit') body.keep_audio = job.audio;
  if (job.task === 'talk' && job.resolution !== 'auto') body.resolution = model.resolutionMap?.[job.resolution] || job.resolution;
  return body;
}
const safeProviderError = (status) => {
  if ([401, 403].includes(status)) return 'Leverandøren avviste tilgangen. Kontroller nøkkel og modelltilgang.';
  if (status === 402) return 'Leverandøren melder om tom saldo eller manglende betaling.';
  if (status === 429) return 'Leverandørens kapasitets- eller forbruksgrense er nådd.';
  return `Leverandørkallet feilet (HTTP ${status}). Ingen automatisk ny generering er startet.`;
};

async function validationError(response) {
  // Never expose reflected inputs, signed URLs, provider debug text or credentials.
  // Only translate known error categories and a fixed allowlist of field names.
  let data;
  try {
    if (response.body) {
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length; if (size > 64 * 1024) return null;
        chunks.push(chunk);
      }
      data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } else data = await response.json();
  } catch { return null; }
  const details = Array.isArray(data?.detail) ? data.detail : [];
  const fields = { image_url: 'startbildet', start_image_url: 'startbildet', video_url: 'videofilen', audio_url: 'lydfilen',
    prompt: 'beskrivelsen', duration: 'varigheten', resolution: 'oppløsningen', aspect_ratio: 'bildeformatet', character_orientation: 'figurens orientering' };
  const names = [...new Set(details.flatMap(detail => Array.isArray(detail.loc) ? detail.loc.filter(key => Object.hasOwn(fields, key)).map(key => fields[key]) : []))];
  const text = [...details.map(detail => `${typeof detail.type === 'string' ? detail.type : ''} ${typeof detail.msg === 'string' ? detail.msg : ''}`), typeof data?.detail === 'string' ? data.detail : '', typeof data?.error === 'string' ? data.error : ''].join(' ').toLowerCase();
  let hint = 'Kontroller filformat, størrelse og modellens inputkrav.';
  if (/width|height|dimension|aspect|resolution|pixel/.test(text)) hint = 'Filens dimensjoner eller sideforhold ble avvist. Se modellens krav til oppløsning og format.';
  else if (/duration|too short|too long/.test(text)) hint = 'Lengden ble avvist. Kontroller modellens minste og største varighet.';
  else if (/face|person|character|human/.test(text)) hint = 'Leverandøren kunne ikke bruke personen eller figuren i referansen. Bruk en tydelig fremføring og et tydelig bilde uten tildekking.';
  else if (/file.size|too large|megabyte|maximum.*bytes/.test(text)) hint = 'En fil er for stor for modellen. Kortere eller mer komprimert input kreves.';
  else if (/moderation|safety|content.policy|nsfw/.test(text)) hint = 'Innholdet ble avvist av leverandørens sikkerhetskontroll.';
  return `Leverandøren avviste ${names.length ? names.join(' og ') : 'inndataene'} (HTTP 422). ${hint} Ingen ny generering er startet.`;
}

function createProviders(readEnv, fetchImpl = fetch) {
  async function json(url, key, body, google = false) {
    const response = await fetchImpl(url, {
      method: body ? 'POST' : 'GET',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(google ? { 'x-goog-api-key': key } : { Authorization: key }) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(body ? 10 * 60 * 1000 : 30000), redirect: 'error'
    });
    if (!response.ok) throw new Error(response.status === 422 ? await validationError(response) || safeProviderError(response.status) : safeProviderError(response.status));
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
        const data = await json(`https://queue.fal.run/${model.endpoints[job.task]}`, `Key ${key}`, falInput(model, job));
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
      // fal queue status/result paths use namespace/model, without subpaths.
      const root = model.endpoints[job.task].split('/').slice(0, 2).join('/');
      const base = `https://queue.fal.run/${root}/requests/${id}`;
      const status = await json(`${base}/status`, `Key ${key}`);
      if (status.status !== 'COMPLETED') return null;
      const result = await json(base, `Key ${key}`);
      if (!result.video?.url) throw new Error('Leverandøren returnerte ikke en videofil.');
      return { url: result.video.url };
    },
    async download(url) {
      const parsed = new URL(url);
      // Output URLs come from providers, never from a user's form.
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
          !(['.x.ai', '.xai.com', '.fal.media'].some(suffix => parsed.hostname.endsWith(suffix)) ||
            (parsed.hostname === 'storage.googleapis.com' && parsed.pathname.startsWith('/falserverless/')))) {
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

module.exports = { VIDEO_MODELS, createProviders, falInput };
