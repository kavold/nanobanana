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

async function normalizeMotionVideo(file, info, { ffmpeg = 'ffmpeg', ffprobe = 'ffprobe' } = {}) {
  const stream = info.streams.find(s => s.codec_type === 'video');
  const original = displaySize(stream), originalBytes = file.size;
  if (![original.width, original.height].every(v => Number.isInteger(v) && v > 0) || original.width * original.height > 33_177_600 || Math.max(original.width, original.height) > 8192) throw new Error('Videobildet er for stort til automatisk klargjøring. Maks 8K input.');
  const duration = Number(info.format.duration);
  if (!Number.isFinite(duration) || duration < 3 || duration > 30) throw new Error('Fremføringen må være 3–30 sekunder før videoen klargjøres.');
  const short = Math.min(original.width, original.height), long = Math.max(original.width, original.height);
  const factor = Math.min(1, Math.max(Math.min(720 / short, 1280 / long), 340 / short));
  const width = Math.max(2, Math.floor(original.width * factor / 2) * 2);
  const height = Math.max(2, Math.floor(original.height * factor / 2) * 2);
  const [n, d = 1] = (stream.r_frame_rate || '').split('/').map(Number);
  const fps = n / d;
  const needsConversion = factor < 1 || file.size > 40 * 1024 * 1024 || stream.codec_name !== 'h264' || stream.pix_fmt !== 'yuv420p' || fps > 30 || /webm|matroska/.test(info.format.format_name);
  let converted = false;
  if (needsConversion) {
    const output = `${file.path}.normalized.mp4`;
    try {
      const filter = `scale=${width}:${height}:flags=lanczos${fps > 30 ? ',fps=30' : ''}`;
      await run(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-threads', '2',
        '-protocol_whitelist', 'file', '-format_whitelist', 'mov,matroska,webm', '-i', file.path,
        '-map', '0:v:0', '-map', '0:a:0?', '-filter_threads', '1', '-vf', filter, '-t', String(duration),
        '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-crf', '23', '-maxrate', '3M', '-bufsize', '6M', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-map_metadata', '-1', '-map_chapters', '-1', '-movflags', '+faststart', output],
      { timeout: 90000, maxBuffer: 128 * 1024 });
      const normalized = await probeVideo(output, ffprobe);
      const video = normalized.streams?.find(s => s.codec_type === 'video');
      const bytes = fs.statSync(output).size;
      if (!video || bytes > 40 * 1024 * 1024 || Math.abs(Number(normalized.format?.duration) - duration) > .25) throw new Error('invalid conversion');
      fs.renameSync(output, file.path); file.size = bytes; info = normalized; converted = true;
    } catch {
      throw new Error('Videoen kunne ikke komprimeres automatisk. Bruk et kortere MP4-klipp, eller prøv en mindre fil. Ingen generering er startet.');
    } finally { fs.rmSync(output, { force: true }); }
  }
  const size = displaySize(info.streams.find(s => s.codec_type === 'video'));
  return { info, inputVideo: { originalWidth: original.width, originalHeight: original.height, originalBytes,
    width: size.width, height: size.height, bytes: file.size, converted, duration: Number(info.format.duration) } };
}
module.exports = { probeVideo, displaySize, normalizeMotionVideo };
