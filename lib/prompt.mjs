import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { c } from '../bundle/scripts/lib/setup-ui.mjs';
import { parseRuntime } from './constants.mjs';
import { ADAPTERS } from './adapters/index.mjs';

/**
 * @param {{ message: string, choices: { key: string, label: string }[] }} opts
 * @returns {Promise<string>}
 */
export async function pickChoice({ message, choices }) {
  if (!process.stdin.isTTY) {
    throw new Error('Interactive picker requires a TTY. Pass --runtime and target path.');
  }
  console.log('');
  console.log(`${c.bold}${message}${c.reset}`);
  for (const ch of choices) {
    console.log(`  ${c.cyan}${ch.key}${c.reset}  ${ch.label}`);
  }
  const rl = readline.createInterface({ input, output });
  try {
    while (true) {
      const ans = (await rl.question(`\n${c.dim}Choice [${choices[0].key}]: ${c.reset}`)).trim();
      const key = ans || choices[0].key;
      const hit = choices.find((c) => c.key === key);
      if (hit) return key;
      console.log(`${c.yellow}Invalid — pick one of: ${choices.map((c) => c.key).join(', ')}${c.reset}`);
    }
  } finally {
    rl.close();
  }
}

/** @returns {Promise<import('./constants.mjs').Runtime>} */
export async function pickRuntimeInteractive() {
  // Choices are derived from the adapter registry, plus a synthesized "both".
  const adapterChoices = ADAPTERS.map((a) => ({ key: a.choice.key, label: a.choice.label }));
  const allKey = String(ADAPTERS.length + 1);
  const choices = [
    ...adapterChoices,
    { key: allKey, label: 'All — every adapter (Cursor + Zed + Claude Code) in the same repo' },
  ];
  const map = Object.fromEntries(ADAPTERS.map((a) => [a.choice.key, a.choice.value]));
  map[allKey] = 'all';
  const key = await pickChoice({
    message: 'Which agent environment do you use?',
    choices,
  });
  return parseRuntime(map[key]);
}

/** @returns {Promise<string>} */
export async function pickTargetInteractive() {
  if (!process.stdin.isTTY) {
    throw new Error('Interactive install requires a TTY. Pass target repo path.');
  }
  const rl = readline.createInterface({ input, output });
  try {
    while (true) {
      const ans = (await rl.question(`${c.bold}Path to your git repo:${c.reset} `)).trim();
      if (ans) return ans.replace(/^~(?=\/)/, process.env.HOME || '');
      console.log(`${c.yellow}Enter a path.${c.reset}`);
    }
  } finally {
    rl.close();
  }
}

/** @returns {Promise<'full' | 'quick'>} */
export async function pickIndexModeInteractive() {
  const key = await pickChoice({
    message: 'Build GitNexus graph index now?',
    choices: [
      { key: '1', label: 'Yes — full index + embeddings (recommended first install)' },
      { key: '2', label: 'Skip — hooks/skills/MCP only (--quick)' },
    ],
  });
  return key === '2' ? 'quick' : 'full';
}

/**
 * Multi-select feature picker. Every capability is independently installable, so the installer has
 * to EXPLAIN each one rather than assume the user wants the lot — most notably the GitNexus module,
 * which needs an external MCP server and, if installed without it, would gate tools behind commands
 * the repo does not have.
 */
export async function pickFeaturesInteractive() {
  const { FEATURES } = await import('./features.mjs');
  const c = colors;
  console.log(`\n${c.bold}Which capabilities do you want?${c.reset}`);
  console.log(`${c.dim}Each works on its own; they compose well together.${c.reset}\n`);
  FEATURES.forEach((f, i) => {
    const tag = f.needsGitnexus ? ` ${c.yellow}[needs GitNexus MCP]${c.reset}` : '';
    console.log(`  ${c.cyan}${i + 1}${c.reset}  ${c.bold}${f.title}${c.reset}${tag}`);
    console.log(`     ${c.dim}${f.blurb}${c.reset}`);
    console.log(`     ${c.dim}→ ${f.why}${c.reset}\n`);
  });
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const ans = (
        await rl.question(`${c.dim}Numbers (e.g. 1,2,3), "all", or Enter for all: ${c.reset}`)
      ).trim();
      if (!ans || ans.toLowerCase() === 'all') return FEATURES.map((f) => f.id);
      const picked = ans
        .split(/[,\s]+/)
        .filter(Boolean)
        .map((n) => FEATURES[Number(n) - 1]);
      if (picked.length && picked.every(Boolean)) return picked.map((f) => f.id);
      console.log(`${c.yellow}Pick from 1-${FEATURES.length}, comma separated.${c.reset}`);
    }
  } finally {
    rl.close();
  }
}
