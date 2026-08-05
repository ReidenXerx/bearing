#!/usr/bin/env node
/** sessionStart stdout: additional_context for agent health confirmation ritual. */
import fs from 'node:fs';
import path from 'node:path';
import {
  auditKitHealth,
  agentContextForSession,
  writeSessionHealthFile,
  SESSION_USER_NOTIFIED_FLAG,
} from './session-health-audit.mjs';

const root = process.argv[2] ?? process.cwd();

try {
  fs.unlinkSync(path.join(root, '.bearing', SESSION_USER_NOTIFIED_FLAG));
} catch {
  /* ignore */
}

const audit = auditKitHealth(root);
writeSessionHealthFile(root, audit);

process.stdout.write(
  JSON.stringify({
    additional_context: agentContextForSession(audit),
  })
);
