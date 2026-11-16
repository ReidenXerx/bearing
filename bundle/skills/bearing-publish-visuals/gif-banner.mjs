#!/usr/bin/env node
/**
 * A looping section banner from footage — GIF and animated WebP together, under a size cap.
 *
 *   node gif-banner.mjs <clip> <out-base> [--start 0] [--dur 5] [--y 0.5] [--x 0.5] [--cw px]
 *                                         [--ratio 3.5] [--width 1000] [--fps 15] [--cap-mb 8] [--pingpong]
 *
 * Writes <out-base>.gif and <out-base>.webp. The algorithm is a publisher's, used on real mod pages:
 * - a strip `ratio:1` (3.5 by default) at full source width — or `--cw` px centred on `--x` — centred
 *   vertically on `--y` (0..1) and clamped inside the frame. **Keep the ACTION in it**: a strip that
 *   cut off the hand doing the reload had to be re-cut at full width.
 * - ONE palette for the whole clip, built from what MOVES (`stats_mode=diff`), Bayer dither.
 * - over the cap: drop fps by 3 while above 12, then width by 15% (kept even); after 7 tries, stop
 *   and say "shorten the clip" — cutting length beats cutting quality.
 * - `--pingpong` plays forward then back, hiding the seam of footage that does not loop by itself.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const [clip, outBase] = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--") && argv[i - 1] !== "--pingpong"));
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? Number(argv[i + 1]) : dflt;
};
if (!clip || !outBase || !fs.existsSync(clip)) {
  console.error("usage: node gif-banner.mjs <clip> <out-base> [--start s] [--dur s] [--y 0..1] [--x 0..1] [--cw px] [--ratio 3.5] [--width 1000] [--fps 15] [--cap-mb 8] [--pingpong]");
  process.exit(2);
}
const start = opt("start", 0), dur = opt("dur", 5), ratio = opt("ratio", 3.5), cap = opt("cap-mb", 8) * 1024 * 1024;
const pingpong = argv.includes("--pingpong");
const [sw, sh] = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", clip], { encoding: "utf8" }).trim().split(",").map(Number);
const cw = Math.min(sw, opt("cw", sw));
const ch = Math.round(cw / ratio);
if (ch > sh) {
  console.error(`✗ a ${ratio}:1 strip ${cw} px wide is ${ch} px tall — taller than the ${sh}-px clip. Narrow it with --cw.`);
  process.exit(1);
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const cy = clamp(Math.round(opt("y", 0.5) * sh - ch / 2), 0, sh - ch);
const cx = clamp(Math.round(opt("x", 0.5) * sw - cw / 2), 0, sw - cw);

const FFMPEG = process.env.FFMPEG || "ffmpeg"; // point at a build with libwebp when the WebP matters
const ff = (args) => execFileSync(FFMPEG, ["-nostdin", "-v", "error", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
fs.mkdirSync(path.dirname(path.resolve(outBase)), { recursive: true });
// Animated WebP needs an encoder many ffmpeg builds lack (Homebrew's has none). Use ffmpeg's if it
// has one, else libwebp's own gif2webp on the finished GIF, else GIF only — said, not silently.
const encoders = spawnSync(FFMPEG, ["-hide_banner", "-encoders"], { encoding: "utf8" }).stdout ?? "";
const webpEncoder = /\blibwebp_anim\b/.test(encoders) ? "libwebp_anim" : /\blibwebp\b/.test(encoders) ? "libwebp" : null;
const gif2webp = spawnSync("sh", ["-c", "command -v gif2webp"]).status === 0;
// Which path made the WebP is part of the result: the gif2webp one inherits the GIF's palette.
const webpPath = webpEncoder ? `webp via ffmpeg ${webpEncoder}` : gif2webp ? "webp via gif2webp (palette-limited — set FFMPEG to a build with libwebp for a direct encode)" : null;
if (!webpPath) console.log("  ⚠ no animated-WebP encoder here (ffmpeg libwebp or gif2webp) — writing the GIF only");
const render = (fps, width) => {
  const even = width - (width % 2);
  const base = `crop=${cw}:${ch}:${cx}:${cy},fps=${fps},scale=${even}:-2:flags=lanczos`;
  const chain = pingpong ? `${base},split[f][r];[r]reverse[rv];[f][rv]concat=n=2:v=1:a=0` : base;
  const input = ["-ss", String(start), "-t", String(dur), "-i", clip];
  ff([...input, "-filter_complex", `${chain},split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, "-loop", "0", `${outBase}.gif`]);
  if (webpEncoder) {
    ff([...input, "-filter_complex", chain, "-c:v", webpEncoder, "-lossless", "0", "-q:v", "70", "-compression_level", "6", "-loop", "0", "-an", `${outBase}.webp`]);
  } else if (gif2webp) {
    execFileSync("gif2webp", ["-lossy", "-q", "70", "-m", "6", "-quiet", `${outBase}.gif`, "-o", `${outBase}.webp`]);
  }
  const webp = fs.existsSync(`${outBase}.webp`) ? fs.statSync(`${outBase}.webp`).size : 0;
  return [fs.statSync(`${outBase}.gif`).size, webp];
};

try {
let fps = opt("fps", 15);
let width = opt("width", 1000);
for (let attempt = 1; attempt <= 7; attempt++) {
  const [g, w] = render(fps, width);
  const mb = (n) => (n / 1048576).toFixed(1);
  if (g <= cap && w <= cap) {
    console.log(`✓ ${outBase}.gif ${mb(g)} MB${w ? ` · ${outBase}.webp ${mb(w)} MB (${webpPath})` : ""} — ${width}px, ${fps} fps. Now LOOK at it: is the action in the strip?`);
    process.exit(0);
  }
  if (fps > 12) fps = Math.max(12, fps - 3);
  else width = Math.round(width * 0.85);
}
console.error(`✗ still over ${cap / 1048576} MB after 7 tries — shorten the clip (--dur); cutting length beats cutting quality.`);
process.exit(1);
} catch (e) {
  // One line, not a stack: the ffmpeg message is the useful part.
  console.error(`✗ ${String(e.stderr || e.message).trim().split("\n").slice(-2).join(" — ")}`);
  process.exit(1);
}
