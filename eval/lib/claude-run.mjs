/**
 * Shared by the eval harnesses: run one headless Claude Code session and measure it from Claude
 * Code's own event stream (stream-json) — tool calls, hook denials, tokens, cost — identically in
 * every condition. The thing under test never grades itself (NS-27).
 *
 * Isolation: user settings, plugins and claude.ai connectors are excluded (`--setting-sources
 * project,local`, `--strict-mcp-config`), so a condition gets exactly what its fixture repo carries.
 * Every CLAUDE* and GIT_* variable is stripped first — run from inside a Claude Code session, the
 * child would otherwise inherit that session's messaging socket and id.
 */
import { spawn } from "node:child_process";

/** The environment a child `claude` gets: ours, minus anything that ties it to THIS session. */
export function childEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^CLAUDE/.test(k) && !/^GIT_/.test(k)));
}

/**
 * Run one agent session; resolve with the parsed stream and the session id.
 *
 * `persist` keeps the session on disk so a later call can `resume` it — a multi-step task that runs
 * `/compact` between steps needs both (verified: `claude -p "/compact" --resume <id>` emits a real
 * `compact_boundary`, and the resumed session continues). Off by default: a single-shot task has
 * nothing to resume, and an unpersisted session leaves nothing behind in ~/.claude.
 */
export function agent({ cwd, prompt, model, mcpConfig, timeoutMs, maxBudgetUsd, resume = null, persist = false }) {
  const argv = [
    "-p", prompt,
    "--output-format", "stream-json", "--verbose",
    "--model", model,
    "--setting-sources", "project,local",
    "--strict-mcp-config",
    ...(mcpConfig ? ["--mcp-config", mcpConfig] : []),
    "--dangerously-skip-permissions",
    ...(resume ? ["--resume", resume] : []),
    ...(persist || resume ? [] : ["--no-session-persistence"]),
    "--max-budget-usd", String(maxBudgetUsd),
  ];
  return new Promise((resolve) => {
    const child = spawn("claude", argv, { cwd, env: childEnv(), stdio: ["ignore", "pipe", "pipe"] });
    let buf = "";
    let stderr = "";
    const events = [];
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        try {
          events.push(JSON.parse(line));
        } catch {
          /* non-JSON noise */
        }
      }
    });
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const sessionId = events.find((e) => typeof e?.session_id === "string")?.session_id ?? null;
      resolve({ code, signal, events, sessionId, stderr: stderr.slice(-2000) });
    });
  });
}

/** Tool calls, hook denials, tokens and cost — from the stream, identically for every condition. */
export function measure(events) {
  const tools = {};
  let hookDenials = 0;
  let toolErrors = 0;
  const names = new Map();
  const sequence = [];
  // Kept verbatim (clipped), so a "denial" can be checked by reading it rather than trusted as a
  // count — the classifier below is a regex, and a regex is a claim (NS-20).
  const denialSamples = [];
  const errorSamples = [];
  // Whether a tool was USED, from the commands themselves — counted, never stored, because a command
  // line can carry a private repository's paths and code into a results file.
  let astGrepCalls = 0;
  let knipCalls = 0;
  let blameCalls = 0;
  // A blame that looks past a reformat: an ignored revision, or a re-blame from a commit's parent.
  let blamePastFormatCalls = 0;
  const skills = [];
  for (const e of events) {
    const content = e?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b.type === "tool_use") {
        tools[b.name] = (tools[b.name] ?? 0) + 1;
        names.set(b.id, b.name);
        sequence.push(b.name);
        const cmd = b.name === "Bash" ? String(b.input?.command ?? "") : "";
        if (/\bast-grep\b|@ast-grep\/cli/.test(cmd)) astGrepCalls++;
        if (/\bknip\b/.test(cmd)) knipCalls++;
        if (/\bgit\s+blame\b/.test(cmd)) {
          blameCalls++;
          if (/--ignore-revs?(?:-file)?\b|\s[0-9a-f]{6,40}\^/.test(cmd)) blamePastFormatCalls++;
        }
        if (b.name === "Skill" && typeof b.input?.skill === "string") skills.push(b.input.skill);
      } else if (b.type === "tool_result" && b.is_error) {
        toolErrors++;
        const text = typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? "");
        const sample = `${names.get(b.tool_use_id) ?? "?"}: ${text.replace(/\s+/g, " ").slice(0, 240)}`;
        if (/hook|blocked|PreToolUse|bearing:fallback|gitnexus_/i.test(text)) {
          hookDenials++;
          if (denialSamples.length < 5) denialSamples.push(sample);
        } else if (errorSamples.length < 5) {
          // Every other tool error, verbatim too: a failure that cannot be read cannot be classified.
          errorSamples.push(sample);
        }
        sequence.push(`!${names.get(b.tool_use_id) ?? "?"}`);
      }
    }
  }
  // One process can emit SEVERAL result events: when the agent starts a background command, Claude
  // Code wakes it again when the command finishes, and that extra turn ends in a result of its own.
  // Found in the hard round's smoke: rows reported 3 seconds and one turn for an agent that had
  // wrapped 106 files, and the "answer" was "Nothing else is pending." Verified with a probe:
  // total_cost_usd is CUMULATIVE across the results, while num_turns, duration_ms and usage are per
  // segment. So cost is the largest total, the rest are summed, and the answer is every result's
  // text in order — the real answer is rarely the last one.
  const results = events.filter((e) => e?.type === "result");
  const result = results[results.length - 1] ?? {};
  const sumOf = (f) => results.reduce((s, r) => s + (f(r) ?? 0), 0);
  const u = {
    input_tokens: sumOf((r) => r.usage?.input_tokens),
    output_tokens: sumOf((r) => r.usage?.output_tokens),
    cache_read_input_tokens: sumOf((r) => r.usage?.cache_read_input_tokens),
    cache_creation_input_tokens: sumOf((r) => r.usage?.cache_creation_input_tokens),
  };
  const costs = results.map((r) => r.total_cost_usd).filter((c) => typeof c === "number");
  const graphCalls = Object.entries(tools).filter(([n]) => n.startsWith("mcp__gitnexus__")).reduce((s, [, c]) => s + c, 0);
  // Subagents spawned. Claude Code names the tool `Agent`; older builds named it `Task`. Counted here
  // because what microscope and minions change is mostly whether, and how much, the agent fans out.
  const subagents = (tools.Agent ?? 0) + (tools.Task ?? 0);
  const compactions = events.filter((e) => e?.type === "system" && e?.subtype === "compact_boundary").length;
  return {
    tools,
    toolCalls: Object.values(tools).reduce((s, c) => s + c, 0),
    graphCalls,
    subagents,
    compactions,
    hookDenials,
    astGrepCalls,
    knipCalls,
    blameCalls,
    blamePastFormatCalls,
    skills,
    denialSamples,
    errorSamples,
    toolErrors,
    sequence,
    tokens: {
      input: u.input_tokens ?? 0,
      output: u.output_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
      cacheCreate: u.cache_creation_input_tokens ?? 0,
    },
    costUsd: costs.length ? Math.max(...costs) : null,
    turns: results.length ? sumOf((r) => r.num_turns) : null,
    durationMs: results.length ? sumOf((r) => r.duration_ms) : null,
    results: results.length,
    isError: Boolean(result.is_error),
    resultText: results.map((r) => (typeof r.result === "string" ? r.result : "")).filter(Boolean).join("\n\n"),
  };
}

