#!/usr/bin/env node
/**
 * Generate an architecture overview from the GitNexus graph — offline, no API key.
 * Reads .gitnexus/meta.json stats + queries clusters/processes via the CLI.
 * Writes docs/ARCHITECTURE.gitnexus.md. Best-effort: degrades to stats-only if cypher unavailable.
 */
import fs from "node:fs";
import path from "node:path";
import { repoName } from "./hook-helpers.mjs";
import { runCypher, parseRows } from "./cypher-cli.mjs";

export const ARCH_DOC_PATH = "docs/ARCHITECTURE.gitnexus.md";

/**
 * @param {string} root
 * @param {string} [repoArg]
 * @param {Record<string,string>} [env]
 * @returns {{ written: boolean, path: string, reason?: string }}
 */
export function generateArchDoc(root, repoArg, env) {
  const repo = repoArg ?? repoName(root);
  const metaPath = path.join(root, ".gitnexus/meta.json");
  if (!fs.existsSync(metaPath)) {
    return {
      written: false,
      path: ARCH_DOC_PATH,
      reason: "no .gitnexus/meta.json — run gitnexus:refresh first",
    };
  }

  let stats = {};
  let lastCommit = "";
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    stats = meta.stats ?? {};
    lastCommit = meta.lastCommit ?? "";
  } catch {
    return { written: false, path: ARCH_DOC_PATH, reason: "invalid meta.json" };
  }

  const clusters = safeRows(
    root,
    repo,
    "MATCH (c:Community) RETURN c.heuristicLabel, c.symbolCount ORDER BY c.symbolCount DESC LIMIT 15",
    env,
  );
  const processes = safeRows(
    root,
    repo,
    "MATCH (p:Process) RETURN p.heuristicLabel, p.stepCount ORDER BY p.stepCount DESC LIMIT 15",
    env,
  );

  const lines = [];
  lines.push(`# Architecture — ${repo}`);
  lines.push("");
  lines.push(
    "> Auto-generated from the GitNexus knowledge graph. Do not edit by hand — regenerate with `npm run gitnexus:map`.",
  );
  lines.push(
    `> Generated ${new Date().toISOString()}${lastCommit ? ` @ ${lastCommit.slice(0, 7)}` : ""}.`,
  );
  lines.push("");
  lines.push("## Graph at a glance");
  lines.push("");
  lines.push("| Metric | Count |");
  lines.push("| --- | --- |");
  lines.push(`| Symbols | ${stats.nodes ?? "?"} |`);
  lines.push(`| Execution flows (processes) | ${stats.processes ?? "?"} |`);
  lines.push(`| Functional areas (clusters) | ${stats.communities ?? "?"} |`);
  lines.push(`| Embeddings | ${stats.embeddings ?? 0} |`);
  lines.push("");

  if (clusters.length) {
    lines.push("## Functional areas (largest clusters)");
    lines.push("");
    lines.push("| Area | Symbols |");
    lines.push("| --- | --- |");
    for (const [label, count] of clusters) {
      lines.push(`| ${label} | ${count ?? ""} |`);
    }
    lines.push("");
    lines.push(
      `Explore an area: \`READ gitnexus://repo/${repo}/cluster/<Area>\``,
    );
    lines.push("");
  }

  if (processes.length) {
    lines.push("## Key execution flows (longest processes)");
    lines.push("");
    lines.push("| Flow | Steps |");
    lines.push("| --- | --- |");
    for (const [label, count] of processes) {
      lines.push(`| ${label} | ${count ?? ""} |`);
    }
    lines.push("");
    lines.push(`Trace a flow: \`READ gitnexus://repo/${repo}/process/<Flow>\``);
    lines.push("");
  }

  lines.push("## How to navigate this codebase");
  lines.push("");
  lines.push("```");
  lines.push(`READ gitnexus://repo/${repo}/context     # stats + freshness`);
  lines.push(`READ gitnexus://repo/${repo}/clusters    # functional areas`);
  lines.push(`READ gitnexus://repo/${repo}/processes   # execution flows`);
  lines.push(
    `gitnexus_query({ search_query: "<concept>", repo: "${repo}" })   # orient (BM25 + embeddings)`,
  );
  lines.push(
    `gitnexus_context({ name: "<symbol>", repo: "${repo}" })   # 360° on one symbol`,
  );
  lines.push("```");
  lines.push("");

  const out = path.join(root, ARCH_DOC_PATH);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, lines.join("\n") + "\n");
  return { written: true, path: ARCH_DOC_PATH };
}

function safeRows(root, repo, query, env) {
  try {
    const r = runCypher(root, repo, query, env);
    if (!r.ok) return [];
    return parseRows(r.stdout)
      .map((row) => [row[0], row[1]])
      .filter((row) => row[0] && !/^null$/i.test(row[0]));
  } catch {
    return [];
  }
}
