#!/usr/bin/env node
/**
 * Terminal UI helpers for install/setup/verify (ANSI, no dependencies).
 */

const isTty = process.stdout.isTTY;

export const c = {
  reset: isTty ? '\x1b[0m' : '',
  bold: isTty ? '\x1b[1m' : '',
  dim: isTty ? '\x1b[2m' : '',
  blue: isTty ? '\x1b[34m' : '',
  green: isTty ? '\x1b[32m' : '',
  yellow: isTty ? '\x1b[33m' : '',
  red: isTty ? '\x1b[31m' : '',
  cyan: isTty ? '\x1b[36m' : '',
  magenta: isTty ? '\x1b[35m' : '',
};

export function banner(title, subtitle = '') {
  // Width follows the CONTENT. A fixed 62 padded short lines but never grew for long ones, so
  // adding one runtime to the subtitle pushed it past the border and the box stopped closing —
  // on the first screen of `npx bearing`, which is the worst place to look broken.
  const w = Math.max(62, title.length + 2, subtitle.length + 2);
  const line = '═'.repeat(w);
  console.log('');
  console.log(`${c.cyan}╔${line}╗${c.reset}`);
  console.log(`${c.cyan}║${c.reset}${c.bold} ${title.padEnd(w - 1)}${c.reset}${c.cyan}║${c.reset}`);
  if (subtitle) {
    console.log(`${c.cyan}║${c.reset} ${c.dim}${subtitle.padEnd(w - 1)}${c.reset}${c.cyan}║${c.reset}`);
  }
  console.log(`${c.cyan}╚${line}╝${c.reset}`);
  console.log('');
}

export function step(n, total, msg) {
  console.log(`${c.blue}==>${c.reset} ${c.dim}[${n}/${total}]${c.reset} ${msg}`);
}

export function ok(msg) {
  console.log(`${c.green}    ✓${c.reset} ${msg}`);
}

export function warn(msg) {
  console.log(`${c.yellow}    !${c.reset} ${msg}`);
}

export function fail(msg) {
  console.error(`${c.red}    ✗${c.reset} ${msg}`);
}

export function info(msg) {
  console.log(`${c.dim}    ${msg}${c.reset}`);
}

/**
 * @param {{ title: string, rows: { label: string, value: string, status?: 'ok'|'warn'|'fail'|'info' }[] }} report
 */
export function summaryTable({ title, rows }) {
  console.log('');
  console.log(`${c.bold}${title}${c.reset}`);
  const labelW = Math.min(28, Math.max(12, ...rows.map((r) => r.label.length)));
  for (const row of rows) {
    const icon =
      row.status === 'ok'
        ? `${c.green}✓${c.reset}`
        : row.status === 'warn'
          ? `${c.yellow}!${c.reset}`
          : row.status === 'fail'
            ? `${c.red}✗${c.reset}`
            : ' ';
    console.log(`  ${icon} ${row.label.padEnd(labelW)} ${row.value}`);
  }
  console.log('');
}

export function nextSteps(lines) {
  console.log(`${c.bold}Next steps${c.reset}`);
  lines.forEach((line, i) => console.log(`  ${c.cyan}${i + 1}.${c.reset} ${line}`));
  console.log('');
}
