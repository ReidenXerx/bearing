/**
 * Lay each clip at its step's offset over the recording, trim the dead air, encode a playable MP4.
 *
 *   node .e2e/tools/demo/mux.js <raw.webm> <timeline.json> <out.mp4>
 *
 * The recording starts when the page is created — sign-in and first load included — so the video is
 * trimmed to just before the first step, and every clip is delayed by its step's offset minus that
 * trim. H.264 + AAC, yuv420p, faststart: the file plays in a browser, on a phone and in Slack.
 * `page.video().path()` resolves only after the CONTEXT closes — take `page.video()` before closing.
 */
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

/** The ffmpeg argv — pure, so it can be checked without running ffmpeg. */
function muxArgs(video, timeline, out, { lead = 0.6, tail = 1.0 } = {}) {
  const steps = timeline.steps;
  if (!steps.length) throw new Error('the timeline has no steps');
  const trim = Math.max(0, steps[0].ms / 1000 - lead);
  const last = steps[steps.length - 1];
  const length = last.ms / 1000 + last.seconds + tail - trim;
  const args = ['-y', '-nostdin', '-v', 'error', '-ss', trim.toFixed(3), '-i', video];
  const filters = [];
  steps.forEach((s, i) => {
    args.push('-i', s.audio);
    const d = Math.max(0, Math.round(s.ms - trim * 1000));
    filters.push(`[${i + 1}:a]aresample=48000,adelay=${d}|${d}[a${i + 1}]`);
  });
  filters.push(`${steps.map((_, i) => `[a${i + 1}]`).join('')}amix=inputs=${steps.length}:duration=longest:normalize=0,apad[aout]`);
  args.push('-filter_complex', filters.join(';'), '-map', '0:v', '-map', '[aout]', '-t', length.toFixed(3),
    '-c:v', 'libx264', '-crf', '22', '-pix_fmt', 'yuv420p', '-r', '25',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out);
  return { args, trim, length };
}

if (require.main === module) {
  const [video, timelineFile, out] = process.argv.slice(2);
  if (!video || !timelineFile || !out) {
    console.error('usage: node mux.js <raw.webm> <timeline.json> <out.mp4>');
    process.exit(2);
  }
  try {
    const { args, trim, length } = muxArgs(video, JSON.parse(fs.readFileSync(timelineFile, 'utf8')), out);
    execFileSync('ffmpeg', args, { stdio: 'inherit' });
    console.log(`✓ ${out} — ${length.toFixed(1)} s (trimmed ${trim.toFixed(1)} s of dead air). Now run review.js before sending it.`);
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
}

module.exports = { muxArgs };
