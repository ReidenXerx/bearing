/**
 * Review a demo before it is sent — a video is a claim too.
 *
 *   node .e2e/tools/demo/review.js <out.mp4> <timeline.json> <outDir>
 *
 * Two checks, and a set of pictures you then LOOK at:
 *
 * 1. **Voice against picture.** Just before each step's clip there should be silence, and inside it
 *    speech. A clip laid at the wrong offset talks over the previous step or under the wrong screen.
 *    Measured with ffmpeg `volumedetect` (it prints at info level — `-v error` hides it).
 * 2. **One frame per step**, on contact sheets (3×3), written to outDir. Look at every sheet. A frame
 *    that looks wrong may have missed the moment — pull denser frames inside that step before
 *    calling the step broken (three "broken" steps on a first sheet all turned out fine).
 *
 * Exits 1 when a step is silent or the gap before it is not. The pictures are yours to judge.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

/** Mean volume in dB of [start, start+dur) — -91 is digital silence. */
function meanVolume(file, start, dur) {
  const r = spawnSync('ffmpeg', ['-nostdin', '-hide_banner', '-ss', start.toFixed(3), '-t', dur.toFixed(3), '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = String(r.stderr).match(/mean_volume:\s*(-?[\d.]+|-inf) dB/);
  if (!m) return -Infinity;
  return m[1] === '-inf' ? -Infinity : Number(m[1]);
}

function review(video, timeline, outDir, { silenceDb = -60, speechDb = -40, window = 0.35, lead = 0.6 } = {}) {
  const steps = timeline.steps;
  const trim = Math.max(0, steps[0].ms / 1000 - lead);
  fs.mkdirSync(outDir, { recursive: true });
  const problems = [];
  const frames = [];
  steps.forEach((s, i) => {
    const at = s.ms / 1000 - trim;
    if (at >= window) {
      const before = meanVolume(video, at - window, window * 0.9);
      if (before > silenceDb) problems.push(`${s.key}: not silent before its clip (${before.toFixed(1)} dB) — clips overlap`);
    }
    const inside = meanVolume(video, at + 0.1, Math.min(window, s.seconds));
    if (!(inside > speechDb)) problems.push(`${s.key}: no speech where its clip should be (${inside} dB)`);
    const frame = path.join(outDir, `f${String(i).padStart(2, '0')}-${s.key}.png`);
    execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-ss', (at + Math.min(s.seconds / 2, 2)).toFixed(3), '-i', video, '-frames:v', '1', '-vf', 'scale=640:-1', frame]);
    frames.push(frame);
  });
  const sheets = [];
  for (let i = 0; i < frames.length; i += 9) {
    const group = frames.slice(i, i + 9);
    const sheet = path.join(outDir, `sheet-${sheets.length + 1}.png`);
    const inputs = group.flatMap((f) => ['-i', f]);
    const n = group.length;
    const cols = Math.min(3, n);
    const rows = Math.ceil(n / 3);
    const layout = group.map((_, k) => `${(k % 3) === 0 ? '0' : (k % 3) === 1 ? 'w0' : 'w0+w1'}_${Math.floor(k / 3) === 0 ? '0' : Math.floor(k / 3) === 1 ? 'h0' : 'h0+h1'}`).join('|');
    const filter = n === 1 ? 'null' : `xstack=inputs=${n}:layout=${layout}:fill=black`;
    execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', ...inputs, '-filter_complex', filter, sheet]);
    sheets.push({ sheet, cols, rows });
  }
  return { problems, sheets: sheets.map((s) => s.sheet), frames };
}

if (require.main === module) {
  const [video, timelineFile, outDir] = process.argv.slice(2);
  if (!video || !timelineFile || !outDir) {
    console.error('usage: node review.js <out.mp4> <timeline.json> <outDir>');
    process.exit(2);
  }
  const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', video], { encoding: 'utf8' }).trim());
  const { problems, sheets } = review(video, JSON.parse(fs.readFileSync(timelineFile, 'utf8')), outDir);
  console.log(`  ${path.basename(video)}: ${duration.toFixed(1)} s`);
  for (const s of sheets) console.log(`  contact sheet: ${s} — LOOK at it`);
  if (problems.length) {
    console.log(`✗ ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log('✓ voice and picture line up. Now look at every contact sheet before sending.');
}

module.exports = { review, meanVolume };
