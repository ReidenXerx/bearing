/**
 * Voice first: one clip per step, generated and MEASURED before anything is recorded.
 *
 *   node .e2e/tools/demo/narrate.js demo/steps.json demo/narration
 *
 * steps.json is `[{ "key": "intro", "text": "One sentence, tied to one visible action." }, …]`.
 * Writes one audio file per step and `narration.json` — the same steps with `audio` and `seconds`.
 *
 * Why first: the recording paces itself to the voice. A recording that guesses how long a sentence
 * takes either cuts the voice off or leaves the screen frozen; measuring the clip makes the pause
 * exact. Uses macOS `say` (DEMO_VOICE, DEMO_RATE), else `espeak-ng`; `ffprobe` measures.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const has = (bin) => spawnSync('sh', ['-c', `command -v ${bin}`]).status === 0;

function synth(text, outBase) {
  if (has('say')) {
    const out = `${outBase}.aiff`;
    execFileSync('say', ['-v', process.env.DEMO_VOICE || 'Samantha', '-r', process.env.DEMO_RATE || '178', '-o', out, text]);
    return out;
  }
  if (has('espeak-ng')) {
    const out = `${outBase}.wav`;
    execFileSync('espeak-ng', ['-s', process.env.DEMO_RATE || '165', '-w', out, text]);
    return out;
  }
  throw new Error('no text-to-speech here: macOS `say` or `espeak-ng` is needed (or put your own recorded clips in narration.json)');
}

function seconds(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' });
  const s = Number(out.trim());
  if (!(s > 0)) throw new Error(`ffprobe could not measure ${file}`);
  return Math.round(s * 100) / 100;
}

function narrate(stepsFile, outDir) {
  const steps = JSON.parse(fs.readFileSync(stepsFile, 'utf8'));
  if (!Array.isArray(steps) || !steps.length) throw new Error(`${stepsFile}: expected a non-empty array of { key, text }`);
  const keys = new Set();
  fs.mkdirSync(outDir, { recursive: true });
  const out = steps.map(({ key, text }) => {
    if (!key || !text) throw new Error(`every step needs a key and a text: ${JSON.stringify({ key, text })}`);
    if (keys.has(key)) throw new Error(`step key "${key}" is used twice — the timeline finds steps by key`);
    keys.add(key);
    const audio = synth(text, path.join(outDir, key));
    return { key, text, audio: path.resolve(audio), seconds: seconds(audio) };
  });
  const file = path.join(outDir, 'narration.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  return { file, steps: out };
}

if (require.main === module) {
  const [stepsFile, outDir] = process.argv.slice(2);
  if (!stepsFile || !outDir) {
    console.error('usage: node narrate.js <steps.json> <outDir>');
    process.exit(2);
  }
  try {
    const { file, steps } = narrate(stepsFile, outDir);
    const total = steps.reduce((n, s) => n + s.seconds, 0);
    console.log(`✓ ${steps.length} clips, ${total.toFixed(1)} s of speech → ${file}`);
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
}

module.exports = { narrate };
