import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { c } from '../bundle/scripts/lib/setup-ui.mjs';
import { parseRuntime } from './constants.mjs';
import { ADAPTERS } from './adapters/index.mjs';

/**
 * @param {{ message: string, choices: { key: string, label: string }[] }} opts
 * @returns {Promise<string>}
 */
const { DEFAULT_HTTP_PORT } = await import('./mcp-config.mjs');

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
    { key: allKey, label: 'All — every adapter (Cursor + Zed + Claude Code + Codex) in the same repo' },
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

/**
 * Team install or stealth? Asked because the answer decides whether we write into a repo the user
 * may not own — the one question here with a consequence for people who are not in the room.
 *
 * Only worth asking when it is a real choice: a repo with bearing already committed cannot be made
 * stealthy (installKit refuses, by design), so the caller skips this rather than offer something
 * we would then reject.
 * @returns {Promise<boolean>} true for stealth
 */
export async function pickStealthInteractive() {
  const key = await pickChoice({
    message: 'Who is this install for?',
    choices: [
      { key: '1', label: 'The team — commit bearing so everyone who pulls gets it' },
      { key: '2', label: 'Only me — stealth: nothing bearing writes is visible to git' },
    ],
  });
  return key === '2';
}

/**
 * Only asked when Prettier was actually detected, and the evidence is quoted back: the user is
 * being asked to let an installer edit their formatter's config, so "what makes you think so"
 * has to be answerable without taking bearing's word for it.
 * @param {string} why the file or package.json field that gave Prettier away
 * @param {number} pathCount how many bearing-owned paths the block would exempt
 */
export async function pickPrettierIgnoreInteractive(why, pathCount) {
  console.log('');
  console.log(`${c.bold}This repo runs Prettier${c.reset} ${c.dim}(found ${why})${c.reset}`);
  console.log(
    `${c.dim}bearing installs files it OWNS and replaces on every update — the hook lib, the skill`,
  );
  console.log(
    `store, the rules. Prettier reformats them, the next update overwrites them back, and that`,
  );
  console.log(`diff returns every cycle.${c.reset}`);
  const key = await pickChoice({
    message: `Add ${pathCount} bearing-owned paths to .prettierignore?`,
    choices: [
      { key: '1', label: "Yes — stop the two tools rewriting each other's work" },
      { key: '2', label: 'No — leave .prettierignore alone (your files, your call)' },
    ],
  });
  return key === '1';
}

/**
 * Ask before spending CI time on it. The ordering is only worth anything when the index is warm,
 * and it costs one graph call per changed symbol — cheap on a normal PR, not free on a 400-symbol
 * refactor. It also posts to the pull request, which is someone else's review surface.
 * @returns {Promise<boolean>}
 */
export async function pickTestOrderInteractive() {
  console.log('');
  console.log(`${c.bold}Blast-radius test ordering in CI${c.reset}`);
  console.log(
    `${c.dim}On each PR, work out which test files reach the changed symbols and report them`,
  );
  console.log(`first, so a suite that takes 20 minutes gives its real signal in the first two.`);
  console.log(`It never SKIPS a test — the graph cannot prove a test is irrelevant.${c.reset}`);
  const key = await pickChoice({
    message: 'Include the test order in the PR report?',
    choices: [
      { key: '1', label: 'Yes — rank the impacted tests on every pull request' },
      { key: '2', label: 'No — keep the PR report to blast radius only' },
    ],
  });
  return key === '1';
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
/**
 * How the GitNexus MCP server should run.
 *
 * Asked outright rather than inferred, because the http option installs a background service on
 * the user's machine and that is not something to arrange behind their back (NS-1). The default
 * stays stdio: it needs no daemon, no port and no privileges, and works on a fresh machine.
 *
 * The cost of stdio is real though, and the prompt says so plainly: MCP stdio is one child
 * process PER CLIENT by protocol design, so every editor window and agent session spawns its own
 * server. They all watch the same index and all auto-refresh on staleness, so they queue behind
 * one lock — seven servers on one machine is what prompted this.
 *
 * @returns {Promise<{ transport: string, install: boolean }>}
 */
export async function pickMcpTransportInteractive() {
  console.log(`\n${c.bold}How should the GitNexus MCP server run?${c.reset}`);
  console.log(
    `${c.dim}stdio spawns one server per editor window and per agent session — they contend on\n` +
      `one index. A shared HTTP server is a single process for every repo on the machine.${c.reset}\n`,
  );
  const key = await pickChoice({
    message: 'Transport',
    choices: [
      { key: '1', label: 'stdio — no setup, one server per client (default, works everywhere)' },
      { key: '2', label: `shared HTTP server on port ${DEFAULT_HTTP_PORT} — one process for every repo` },
      { key: '3', label: 'shared HTTP server, custom port or URL' },
    ],
  });
  if (key === '1') return { transport: 'stdio', install: false };

  let target = String(DEFAULT_HTTP_PORT);
  if (key === '3') {
    const rl = readline.createInterface({ input, output });
    try {
      const ans = (await rl.question(`\n${c.dim}Port or URL [${DEFAULT_HTTP_PORT}]: ${c.reset}`)).trim();
      if (ans) target = ans;
    } finally {
      rl.close();
    }
  }

  // Only offer to run it if we can actually supervise it here. Elsewhere the config is still
  // written and the exact command is printed — better than pretending to have started something.
  const { canInstallService } = await import('./mcp-service.mjs');
  if (!canInstallService()) {
    return { transport: target, install: false };
  }
  const supervisor =
    process.platform === 'darwin'
      ? 'launchd agent'
      : process.platform === 'win32'
        ? 'scheduled task'
        : 'systemd user service';
  const run = await pickChoice({
    message: `Start it automatically (${supervisor}, loopback only)?`,
    choices: [
      { key: '1', label: 'Yes — install and start it now, restart on failure' },
      { key: '2', label: 'No — just write the config; I will run the server myself' },
    ],
  });
  return { transport: target, install: run === '1' };
}

export async function pickFeaturesInteractive() {
  const { FEATURES } = await import('./features.mjs');
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
