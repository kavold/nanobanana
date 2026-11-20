const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

const VIDEO_PROBE_FIELDS = 'format=duration,format_name:stream=codec_type,codec_name,pix_fmt,width,height,r_frame_rate,duration:stream_side_data=rotation:stream_tags=rotate';
async function probeVideo(file, ffprobe = 'ffprobe') {
  const { stdout } = await run(ffprobe, ['-v', 'error', '-protocol_whitelist', 'file', '-format_whitelist', 'mov,matroska,webm', '-show_entries', VIDEO_PROBE_FIELDS, '-of', 'json', file], { timeout: 10000, maxBuffer: 128 * 1024 });
  return JSON.parse(stdout);
}
function displaySize(stream) {
  const rotation = Number(stream.side_data_list?.find(side => side.rotation !== undefined)?.rotation ?? stream.tags?.rotate ?? 0);
  const swapped = Math.abs(Math.round(rotation / 90)) % 2 === 1;
  return { width: swapped ? stream.height : stream.width, height: swapped ? stream.width : stream.height };
}

async function normalizeVideoInput(file, info, { ffmpeg = 'ffmpeg', ffprobe = 'ffprobe', task = 'motion', minDuration = 3, maxDuration = 30, videoLimits = {}, trimTo } = {}) {
  const stream = info.streams.find(s => s.codec_type === 'video');
  const original = displaySize(stream), originalBytes = file.size;
  if (![original.width, original.height].every(v => Number.isInteger(v) && v > 0) || original.width * original.height > 33_177_600 || Math.max(original.width, original.height) > 8192) throw new Error('Videobildet er for stort til automatisk klargjøring. Maks 8K input.');
  const originalDuration = Number(info.format.duration);
  const duration = trimTo ?? originalDuration;
  const pictureDuration = Number(stream.duration ?? originalDuration);
  if (trimTo !== undefined && (!Number.isFinite(pictureDuration) || pictureDuration + .001 < trimTo)) {
    throw new Error('Videoen er for kort til lydsporet med 0,5 sekunder stillhet. Velg en lengre video eller en kortere lydfil.');
  }
  if (!Number.isFinite(duration) || duration < minDuration || duration > maxDuration) throw new Error(`Videoen må være ${minDuration}–${maxDuration} sekunder før den klargjøres.`);
  const short = Math.min(original.width, original.height), long = Math.max(original.width, original.height);
  if (task === 'upscale' && videoLimits.maxEdge && long > videoLimits.maxEdge) throw new Error(`Dette oppskaleringsvalget støtter maks ${videoLimits.maxEdge} piksler på langsiden. Videoen nedskaleres ikke før oppskalering.`);
  // Motion references can be small; editing/lipsync retain up to 1080p.
  // Upscaling preserves input dimensions within the model's input limit.
  const targetShort = task === 'motion' ? 720 : task === 'upscale' ? Infinity : 1080;
  const targetLong = Math.min(task === 'motion' ? 1280 : 1920, videoLimits.maxEdge || Infinity);
  const minimumEdge = videoLimits.minEdge || (task === 'motion' ? 340 : 0);
  const factor = Math.min(1, Math.max(Math.min(targetShort / short, targetLong / long), minimumEdge / short));
  const width = Math.max(2, Math.floor(original.width * factor / 2) * 2);
  const height = Math.max(2, Math.floor(original.height * factor / 2) * 2);
  const [n, d = 1] = (stream.r_frame_rate || '').split('/').map(Number);
  const fps = n / d;
  const maxFps = videoLimits.maxFps || 30;
  const maxrate = task === 'motion' ? '3M' : '6M';
  const needsConversion = trimTo !== undefined || factor < 1 || file.size > 40 * 1024 * 1024 || stream.codec_name !== 'h264' || stream.pix_fmt !== 'yuv420p' || fps > maxFps || /webm|matroska/.test(info.format.format_name);
  let converted = false;
  if (needsConversion) {
    const output = `${file.path}.normalized.mp4`;
    try {
      const filter = `scale=${width}:${height}:flags=lanczos${fps > maxFps ? `,fps=${maxFps}` : ''}`;
      await run(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-threads', '2',
        '-protocol_whitelist', 'file', '-format_whitelist', 'mov,matroska,webm', '-i', file.path,
        '-map', '0:v:0', ...(trimTo === undefined ? ['-map', '0:a:0?'] : ['-an']), '-filter_threads', '1', '-vf', filter, '-t', String(duration),
        '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-crf', task === 'motion' ? '23' : '20', '-maxrate', maxrate, '-bufsize', task === 'motion' ? '6M' : '12M', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-map_metadata', '-1', '-map_chapters', '-1', '-movflags', '+faststart', output],
      { timeout: 90000, maxBuffer: 128 * 1024 });
      const normalized = await probeVideo(output, ffprobe);
      const video = normalized.streams?.find(s => s.codec_type === 'video');
      const bytes = fs.statSync(output).size;
      if (!video || bytes > 40 * 1024 * 1024 || !Number.isFinite(Number(normalized.format?.duration)) || Math.abs(Number(normalized.format.duration) - duration) > .25) throw new Error('invalid conversion');
      fs.renameSync(output, file.path); file.size = bytes; info = normalized; converted = true;
    } catch {
      throw new Error('Videoen kunne ikke komprimeres automatisk. Bruk et kortere MP4-klipp, eller prøv en mindre fil. Ingen generering er startet.');
    } finally { fs.rmSync(output, { force: true }); }
  }
  const size = displaySize(info.streams.find(s => s.codec_type === 'video'));
  return { info, inputVideo: { originalWidth: original.width, originalHeight: original.height, originalBytes,
    width: size.width, height: size.height, originalDuration, bytes: file.size, converted, duration: Number(info.format.duration) } };
}
const SPEECH_FORMATS = 'wav,mp3,ogg,mov,flac,aac';
async function probeSpeech(file, ffprobe) {
  const { stdout } = await run(ffprobe, ['-v', 'error', '-protocol_whitelist', 'file', '-format_whitelist', SPEECH_FORMATS,
    '-show_entries', 'format=duration,format_name:stream=codec_type,duration', '-of', 'json', file],
  { timeout: 10000, maxBuffer: 128 * 1024 });
  return JSON.parse(stdout);
}

async function padSpeech(file, { ffmpeg, ffprobe }) {
  const output = `${file.path}.padded.wav`;
  try {
    await run(ffmpeg, ['-nostdin', '-v', 'error', '-y', '-threads', '2', '-protocol_whitelist', 'file',
      '-format_whitelist', SPEECH_FORMATS, '-i', file.path, '-map', '0:a:0', '-af', 'aresample=48000,apad=pad_dur=0.5',
      '-t', '31', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', output],
    { timeout: 30000, maxBuffer: 128 * 1024 });
    const info = await probeSpeech(output, ffprobe);
    fs.renameSync(output, file.path);
    return Number(info.format.duration);
  } catch {
    throw new Error('Kunne ikke klargjøre lydsporet. Prøv en annen lydfil.');
  } finally { fs.rmSync(output, { force: true }); }
}

module.exports = { probeVideo, displaySize, normalizeVideoInput, probeSpeech, padSpeech };
