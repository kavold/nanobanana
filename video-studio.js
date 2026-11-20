const { getUsdNokRate } = require('./exchange-rate');
const express = require('express');
const multer = require('multer');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalizeVideoImage } = require('./video-images');
const { probeVideo, displaySize, normalizeVideoInput, probeSpeech, padSpeech } = require('./video-media');
const { VIDEO_MODELS, createProviders } = require('./video-providers');
const { VIDEO_TASKS, modelDurations, estimateVideo } = require('./video-catalogue');
const ACTIVE = new Set(['queued', 'submitting', 'running', 'downloading']);

function createVideoStudio({ readEnv, directory = path.join(__dirname, 'data', 'video'), providers, pollMs = 5000 }) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    if (req.method === 'POST' && req.headers.origin) {
      try {
        if (new URL(req.headers.origin).host !== req.get('host')) return res.status(403).json({ error: 'Forespørselen må komme fra appens egen side.' });
      } catch { return res.status(403).json({ error: 'Ugyldig avsender.' }); }
    }
    next();
  });
  const adapters = providers || createProviders(readEnv);
  function limit(name, fallback) {
    const value = readEnv(name);
    const number = value === '' ? fallback : Number(value);
    if (!Number.isFinite(number) || number < 0) throw new Error(`${name} må være et ikke-negativt tall.`);
    return number;
  }
  const perJob = limit('VIDEO_MAX_JOB_USD', 3);
  const perDay = limit('VIDEO_MAX_DAY_USD', 10);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = path.join(directory, 'jobs.json');
  // Never silently reset the ledger: doing so could reset the spending guard.
  let jobs = fs.existsSync(db) ? JSON.parse(fs.readFileSync(db, 'utf8')) : [];
  if (!Array.isArray(jobs)) throw new Error('Ugyldig videojobbhistorikk.');
  let busy = false; let accepting = false; let timer;
  function save() {
    fs.writeFileSync(`${db}.tmp`, JSON.stringify(jobs, null, 2), { mode: 0o600 });
    fs.renameSync(`${db}.tmp`, db);
  }
  function publicJob(job) {
    const { id, task, model, prompt, duration, aspectRatio, resolution, audio, estimate, reserved,
      status, message, createdAt, completedAt } = job;
    return { id, task, model, prompt, duration, aspectRatio, resolution, audio, estimate, reserved,
      status, message, createdAt, completedAt,
      ...(status === 'completed' ? { videoUrl: `/api/video/jobs/${id}/file` } : {}) };
  }
  function cleanInputs(job) {
    for (const field of ['imagePath', 'videoPath', 'audioPath']) {
      if (job[field]) fs.rmSync(job[field], { force: true });
      delete job[field];
    }
  }
  // A POST may have reached a provider before the process stopped. Never repeat it.
  for (const job of jobs) {
    if (job.status === 'submitting' || (job.status === 'downloading' && !job.remoteId)) {
      job.status = 'attention';
      job.message = 'Avbrutt under leverandørkall. Kontroller leverandørens jobber og forbruk før et nytt forsøk. Reservasjonen beholdes.';
      cleanInputs(job);
    } else if (job.status === 'downloading') job.status = 'running';
  }
  save();

  async function finish(job, result) {
    job.status = 'downloading'; save();
    const bytes = result.bytes || await adapters.download(result.url);
    if (!bytes?.length || bytes.length > 100 * 1024 * 1024 || bytes.toString('ascii', 4, 8) !== 'ftyp') {
      throw new Error('Resultatet er ikke en støttet MP4-fil.');
    }
    const output = path.join(directory, `${job.id}.mp4`);
    fs.writeFileSync(`${output}.tmp`, bytes, { mode: 0o600 });
    fs.renameSync(`${output}.tmp`, output);
    job.status = 'completed'; job.completedAt = new Date().toISOString();
    job.message = 'Videoen er klar.';
    cleanInputs(job); save();
  }
  async function tick() {
    if (busy) return;
    const job = jobs.find(j => ACTIVE.has(j.status));
    if (!job) return;
    busy = true;
    try {
      if (job.status === 'queued') {
        job.status = 'submitting'; save();
        const result = await adapters.submit(job);
        if (result.remoteId) {
          job.remoteId = result.remoteId; job.status = 'running';
          job.message = 'Genereres hos leverandøren.'; cleanInputs(job); save();
        } else await finish(job, result);
      } else if (job.status === 'running') {
        const result = await adapters.poll(job);
        if (result) await finish(job, result);
        else if (Date.now() - Date.parse(job.createdAt) > 60 * 60 * 1000) {
          throw new Error('Jobben har ventet i over én time. Kontroller leverandøren; ingen ny generering er startet.');
        }
      }
    } catch (error) {
      // Do not return provider response bodies: they can contain signed links or secrets.
      job.status = 'attention';
      job.message = error.message.startsWith('Leverandør') || error.message.startsWith('Video') || error.message.startsWith('Jobben') || error.message.startsWith('Google') || error.message.startsWith('Kling')
        ? error.message : 'Kunne ikke fullføre jobben. Kontroller leverandørens jobber og forbruk. Ingen ny generering er startet.';
      cleanInputs(job); save();
    } finally { busy = false; }
  }
  timer = setInterval(() => { tick().catch(() => {}); }, pollMs); timer.unref();
  function spentToday() {
    const today = new Date().toISOString().slice(0, 10);
    return jobs.filter(j => (ACTIVE.has(j.status) || j.status === 'attention' || j.createdAt.startsWith(today)))
      .reduce((sum, j) => sum + j.reserved, 0);
  }
  function catalogue() {
    return {
      maxJobUsd: perJob, maxDayUsd: perDay, reservedTodayUsd: spentToday(),
      version: /^[a-f0-9]{7,40}$/.test(readEnv('RAILWAY_GIT_COMMIT_SHA')) ? readEnv('RAILWAY_GIT_COMMIT_SHA').slice(0, 7) : 'fal-video-20261119',
      tasks: VIDEO_TASKS,
      models: VIDEO_MODELS.map(({ key, endpoints, defaults, ...m }) => ({ ...m, connected: Boolean(readEnv(key)),
        available: true, priceDate: '2026-11-19' }))
    };
  }
  router.get('/config', (req, res) => res.json(catalogue()));
  router.get('/exchange-rate', async (req, res) => res.json(await getUsdNokRate()));
  router.get('/jobs', (req, res) => res.json({ jobs: jobs.map(publicJob).reverse(), reservedTodayUsd: spentToday() }));
  router.get('/jobs/:id/file', (req, res) => {
    const job = jobs.find(j => j.id === req.params.id && j.status === 'completed');
    if (!job) return res.status(404).json({ error: 'Videoen finnes ikke.' });
    res.set('Cache-Control', 'private, no-store');
    res.type('video/mp4');
    if (req.query.download === '1') res.attachment(`video-${job.id}.mp4`);
    res.sendFile(path.join(directory, `${job.id}.mp4`));
  });
  const upload = multer({ dest: directory, limits: { files: 2, fileSize: 200 * 1024 * 1024, fields: 12, fieldSize: 12000 } })
    .fields([{ name: 'image', maxCount: 1 }, { name: 'video', maxCount: 1 }, { name: 'speech', maxCount: 1 }]);

  function validate(body, files) {
    const model = VIDEO_MODELS.find(m => m.id === body.model);
    if (!model || !model.tasks.includes(body.task)) throw new Error('Velg en modell som støtter oppgaven.');
    const task = VIDEO_TASKS[body.task];
    const maxPrompt = model.promptMax || 4000;
    if (typeof body.prompt !== 'string' || (task.promptRequired && !body.prompt.trim()) || body.prompt.length > maxPrompt) throw new Error(`Beskrivelsen må være ${task.promptRequired ? '1' : '0'}–${maxPrompt} tegn.`);
    if (!model.ratios.includes(body.aspectRatio)) throw new Error('Velg et format modellen støtter.');
    const resolution = body.resolution || model.defaultResolution || (body.task === 'motion' ? 'auto' : '720p');
    if (!Object.hasOwn(model.rates, resolution)) throw new Error('Velg en oppløsning modellen støtter.');
    if (!task.measured && !modelDurations(model, resolution).includes(Number(body.duration))) throw new Error('Velg en varighet modellen støtter ved denne oppløsningen.');
    for (const [kind, label] of Object.entries({ image: 'et bilde', video: 'en video', audio: 'en lydfil' })) {
      if (task.inputs.includes(kind) && !files[kind]?.[0]) throw new Error(`Last opp ${label} for denne oppgaven.`);
      if (!task.inputs.includes(kind) && files[kind]) throw new Error('Opplastingen passer ikke til valgt oppgave.');
    }
    if (body.audio !== 'true' && body.audio !== 'false') throw new Error('Ugyldig lydvalg.');
    if (['included', 'input'].includes(model.audio) && body.audio !== 'true') throw new Error('Denne modellen bruker lyd som en del av videoen.');
    return model;
  }
  async function prepare(body, files) {
    const model = validate(body, files);
    let videoSize;
    const data = { task: body.task, model: model.id, prompt: body.prompt.trim(),
      duration: Number(body.duration), aspectRatio: body.aspectRatio,
      resolution: body.resolution || model.defaultResolution || (body.task === 'motion' ? 'auto' : '720p'), audio: body.audio === 'true' };
    const trimToSpeech = body.task === 'lipsync' && body.trimToSpeech === 'true';
    const silence = trimToSpeech ? .5 : 0;
    const mediaTools = { ffmpeg: readEnv('FFMPEG_PATH') || 'ffmpeg', ffprobe: readEnv('FFPROBE_PATH') || 'ffprobe' };
    let audioDuration;
    if (files.audio?.[0]) {
      const file = files.audio[0];
      if (file.size > 10 * 1024 * 1024) throw new Error('Lydfilen kan være maks 10 MB.');
      let info;
      try {
        info = await probeSpeech(file.path, mediaTools.ffprobe);
      } catch { throw new Error('Kunne ikke lese lydfilen. Bruk MP3, WAV, M4A, OGG, AAC eller FLAC.'); }
      const duration = Number(info.format?.duration);
      if (!info.streams?.some(s => s.codec_type === 'audio') || info.streams.some(s => s.codec_type === 'video') ||
          !Number.isFinite(duration) || duration + silence < model.minDuration || duration + silence > model.maxDuration) throw new Error(`Lydfilen må inneholde bare lyd og være ${model.minDuration}–${model.maxDuration} sekunder inkludert eventuell stillhet.`);
      const format = info.format.format_name;
      data.audioMime = /mp3/.test(format) ? 'audio/mpeg' : /wav/.test(format) ? 'audio/wav' : /ogg/.test(format) ? 'audio/ogg' : /flac/.test(format) ? 'audio/flac' : /aac/.test(format) ? 'audio/aac' : 'audio/mp4';
      audioDuration = duration;
      if (trimToSpeech) {
        audioDuration = await padSpeech(file, mediaTools);
        if (!Number.isFinite(audioDuration) || Math.abs(audioDuration - duration - silence) > .1 ||
            audioDuration < model.minDuration || audioDuration > model.maxDuration) {
          throw new Error('Lydsporet med stillhet har en varighet modellen ikke støtter.');
        }
        data.audioMime = 'audio/wav';
        data.speechTiming = { duration: audioDuration, trailingSilence: silence };
      }
      data.audioPath = file.path;
      data.duration = Math.ceil(audioDuration);
      data.aspectRatio = 'Fra referansene';
    }
    if (files.video?.[0]) {
      const file = files.video[0];
      let info;
      try {
        info = await probeVideo(file.path, mediaTools.ffprobe);
      } catch { throw new Error('Kunne ikke lese videoen. MP4/MOV/WebM og ffprobe kreves.'); }
      const duration = Number(info.format?.duration);
      if (!info.streams?.some(s => s.codec_type === 'video') || !Number.isFinite(duration) || (!trimToSpeech && (duration < model.minDuration || duration > model.maxDuration))) throw new Error(`Fremføringen må være en video på ${model.minDuration}–${model.maxDuration} sekunder.`);
      const normalized = await normalizeVideoInput(file, info, { ...mediaTools, trimTo: trimToSpeech ? audioDuration : undefined,
        task: body.task, minDuration: model.minDuration, maxDuration: model.maxDuration, videoLimits: model.videoLimits });
      info = normalized.info; data.inputVideo = normalized.inputVideo;
      const format = info.format.format_name;
      data.videoMime = /webm|matroska/.test(format) ? 'video/webm' : 'video/mp4';
      if (!/webm|matroska|mp4|mov/.test(format)) throw new Error('Bruk MP4, MOV eller WebM.');
      data.videoPath = file.path;
      const videoStream = info.streams.find(s => s.codec_type === 'video');
      videoSize = displaySize(videoStream);
      const limits = model.videoLimits || {};
      const edge = Math.min(videoSize.width, videoSize.height), long = Math.max(videoSize.width, videoSize.height);
      const [frames, seconds = 1] = (videoStream.r_frame_rate || '').split('/').map(Number);
      const fps = frames / seconds;
      if ((limits.minEdge && edge < limits.minEdge) || (limits.maxEdge && long > limits.maxEdge) ||
          (limits.minFps && !(fps >= limits.minFps)) || (limits.maxFps && !(fps <= limits.maxFps)) ||
          (limits.mp4Only && data.videoMime !== 'video/mp4')) throw new Error('Videoens dimensjoner, bildefrekvens eller filformat passer ikke modellen. Se begrensningene ved modellvalget.');
      data.videoDuration = Number(info.format.duration);
      if (body.task === 'lipsync' && Math.abs(data.videoDuration - audioDuration) > .25) {
        throw new Error('Video og lyd må ha samme varighet (maks 0,25 s forskjell). Velg «Trim videoen etter lydsporet» hvis videoen er lengre.');
      }
      if (audioDuration === undefined) data.duration = Math.ceil(duration);
      data.aspectRatio = 'Fra referansene';
    }
    if (files.image?.[0]) {
      if (files.image[0].size > 50 * 1024 * 1024) throw new Error('Bildet kan være maks 50 MB før automatisk forminsking.');
      data.inputImage = await normalizeVideoImage(files.image[0], {
        resolution: data.resolution, aspectRatio: body.aspectRatio,
        followImageRatio: model.provider === 'xai' || model.followImage || body.task === 'talk',
        minimumEdge: model.imageLimits?.minEdge || 0,
        ...(body.task === 'motion' ? { videoSize } : {})
      });
      data.imagePath = files.image[0].path;
      data.imageMime = 'image/webp';
      const limits = model.imageLimits || {};
      const { width, height } = data.inputImage;
      const ratio = width / height;
      if ((limits.minEdge && Math.min(width, height) < limits.minEdge) || (limits.minRatio && ratio < limits.minRatio) ||
          (limits.maxRatio && ratio > limits.maxRatio)) throw new Error('Bildet er for lite eller har et format modellen ikke støtter. Se begrensningene ved modellvalget.');
      if (model.exactImageRatio && Math.abs(ratio - body.aspectRatio.split(':').map(Number).reduce((a, b) => a / b)) > .015) throw new Error('Denne modellen krever at startbildet allerede passer valgt format (16:9 eller 9:16). Velg en annen modell for å beholde hele bildet.');
      if ((body.task === 'image' && (model.provider === 'xai' || model.followImage)) || body.task === 'talk') data.aspectRatio = `${width}:${height}`;
    }
    // Reserve 25% plus input allowance. This is an app guard, not a provider bill guarantee.
    data.estimate = estimateVideo(model, data);
    data.reserved = Number((data.estimate * 1.25 + 0.05).toFixed(4));
    return data;
  }
  function fingerprint(data, files) {
    const { imagePath, videoPath, audioPath, ...stable } = data;
    const hash = crypto.createHash('sha256').update(JSON.stringify(stable));
    for (const file of Object.values(files).flat()) hash.update(fs.readFileSync(file.path));
    return hash.digest('hex');
  }
  router.post(['/quote', '/jobs'], (req, res) => {
    if (accepting) return res.status(409).json({ error: 'En forespørsel behandles allerede.' });
    accepting = true;
    upload(req, res, async error => {
      let retained = false;
      try {
        if (error) throw new Error('Opplastingen feilet. Maks 200 MB for video, 50 MB for bilde og 10 MB for lyd.');
        const files = req.files || {};
        // Keep the boolean audio option separate from the uploaded speech file.
        if (files.speech) { files.audio = files.speech; delete files.speech; }
        const data = await prepare(req.body, files);
        if (req.path === '/quote') return res.json({ estimate: data.estimate, reserved: data.reserved,
          duration: data.duration, aspectRatio: data.aspectRatio, resolution: data.resolution, inputImage: data.inputImage, inputVideo: data.inputVideo, speechTiming: data.speechTiming,
          currency: 'USD', priceDate: '2026-11-19' });
        if (!/^[a-zA-Z0-9-]{16,80}$/.test(req.body.requestId || '')) throw new Error('Ugyldig forespørsels-ID. Last siden på nytt.');
        if (req.body.confirmed !== 'true') throw new Error('Bekreft prisanslaget før generering.');
        const print = fingerprint(data, files);
        const previous = jobs.find(j => j.requestId === req.body.requestId);
        if (previous) {
          if (previous.fingerprint !== print) throw new Error('Forespørsels-ID er allerede brukt med annet innhold.');
          return res.status(200).json(publicJob(previous));
        }
        if (jobs.some(j => ACTIVE.has(j.status))) return res.status(409).json({ error: 'En video genereres allerede. Vent til den er ferdig.' });
        if (!readEnv(VIDEO_MODELS.find(m => m.id === data.model).key)) throw new Error('API-nøkkel mangler for valgt leverandør. Legg den inn på serveren før du genererer.');
        if (data.reserved > perJob || spentToday() + data.reserved > perDay) return res.status(400).json({ error: 'Videoens kostnadsreservasjon overskrider beløpsgrensen. Velg kortere klipp eller vent til neste dag.' });
        const job = { ...data, id: crypto.randomUUID(), requestId: req.body.requestId, fingerprint: print,
          status: 'queued', message: 'Venter på behandling.', createdAt: new Date().toISOString() };
        jobs.push(job); save(); retained = true;
        res.status(202).json(publicJob(job));
        tick().catch(() => {});
      } catch (err) {
        res.status(400).json({ error: error ? 'Opplastingen feilet. Maks 200 MB for video, 50 MB for bilde og 10 MB for lyd.' : (err.message.includes('Input buffer') || err.message.includes('unsupported image') ? 'Ugyldig bildefil.' : err.message) });
      } finally {
        if (!retained) for (const f of Object.values(req.files || {}).flat()) fs.rmSync(f.path, { force: true });
        accepting = false;
      }
    });
  });
  return { router, close: () => clearInterval(timer), tick, catalogue };
}

module.exports = { createVideoStudio };
