#!/usr/bin/env bash
# beforeSubmitPrompt: one-time user notice that GitNexus kit is active + health status.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export GITNEXUS_HOOK_INPUT="$(cat)"
export GITNEXUS_ROOT="$ROOT"

# FAIL OPEN if anything inside fails. With `.bearing/lib` missing — partial uninstall, an update
# that died mid-copy, `git clean -xdf` in a stealth repo — the node block threw ERR_MODULE_NOT_FOUND
# and `set -e` turned that into a non-zero hook exit. Nine of twelve hooks did it at once, so a repo
# whose only fault was a missing directory had its guards failing instead of guarding. A verdict we
# cannot compute is not a denial (NS-5): emit nothing and let the call through.
node <<'NODE' || exit 0
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.env.GITNEXUS_ROOT || '';
const auditMod = await import(
  pathToFileURL(path.join(root, '.bearing/lib/session-health-audit.mjs')).href
);
const { auditKitHealth, userMessageForSession, SESSION_HEALTH_FILE, SESSION_USER_NOTIFIED_FLAG } =
  auditMod;

const cursorDir = path.join(root, '.bearing');
const notifiedFlag = path.join(cursorDir, SESSION_USER_NOTIFIED_FLAG);

function out(obj) {
  process.stdout.write(JSON.stringify(obj));
}

if (fs.existsSync(notifiedFlag)) {
  out({ continue: true });
  process.exit(0);
}

fs.mkdirSync(cursorDir, { recursive: true });
fs.writeFileSync(notifiedFlag, new Date().toISOString());

let audit;
const healthPath = path.join(cursorDir, SESSION_HEALTH_FILE);
if (fs.existsSync(healthPath)) {
  try {
    audit = JSON.parse(fs.readFileSync(healthPath, 'utf8'));
  } catch {
    audit = auditKitHealth(root);
  }
} else {
  audit = auditKitHealth(root);
}

out({
  continue: true,
  user_message: userMessageForSession(audit),
});
NODE
