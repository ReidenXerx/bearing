/**
 * Merge bearing's gold practices into a repo that has been writing its own.
 *
 * The file used to be copied wholesale on every update, and that was deliberate: a stale copy
 * outlives its fix, so bearing owning it outright is what keeps a corrected rule reaching every
 * repo. The header said so, and pointed project rules at `.bearing/northstars.md`.
 *
 * Agents did not do that, and they were not being sloppy. A lesson learned while working — "prove
 * the control arm moves before believing a benchmark" — is a PRACTICE, not a statement about what
 * the project IS, so northstars.md is the wrong shape for it and gold-practices.md is exactly the
 * right one. One repo accumulated fourteen of them. Every single one was one `bearing update` away
 * from being deleted without a word.
 *
 * So the file becomes two files in a trench coat: a marked block bearing rewrites on every update,
 * and everything below it, which bearing never touches. Same mechanism as `.gitignore`,
 * `CLAUDE.md` and `.prettierignore` — the pattern was already here (GP-24).
 *
 * Project rules are numbered `PP-#`, not `GP-#`, because the numbers collide otherwise: one repo's
 * agent wrote a `GP-24` while bearing was independently shipping a different `GP-24` upstream, and
 * a citation that still resolves but now means something else is worse than one that dangles.
 */

export const GP_BEGIN =
  "<!-- BEGIN GENERATED: gold-practices — bearing owns this block and rewrites it on update. Add YOUR rules below the END marker, where they are safe. -->";
export const GP_END = "<!-- END GENERATED: gold-practices -->";

export const PROJECT_HEADING = "## This project's own practices";

/** The seed for the project's half, written once and never again. */
const PROJECT_SEED = `${PROJECT_HEADING}

**Everything below this line is yours. \`bearing update\` never touches it.** Numbered \`PP-#\` so a
citation can never collide with a bearing \`GP-#\` — they are renumbered upstream as rules are added.

Same bar as above: a rule earns its place with a **scar**. If it has no scar it is advice the model
already follows, and it costs context to say so. If a rule here turns out to be true of every
project rather than this one, it belongs upstream — say so and it can be promoted.

<!-- Add PP-1, PP-2, … here. -->
`;

/** `- **GP-12** — **Bound anything on a hot path.** …` → its bold headline, normalised. */
function headlineOf(rule) {
  const m = rule.match(/\*\*\s*—\s*\*\*(.+?)\*\*/s) ?? rule.match(/—\s*\*\*(.+?)\*\*/s);
  return (m?.[1] ?? rule.slice(0, 120)).replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Every `- **GP-n** …` entry in a document, as raw text.
 * @param {string} md @returns {{id: string, body: string, headline: string}[]}
 */
export function parseRules(md) {
  const parts = md.split(/\n(?=- \*\*(?:GP|PP)-\d+\*\*)/);
  const out = [];
  for (const p of parts) {
    const m = p.match(/^- \*\*((?:GP|PP)-\d+)\*\*/);
    if (!m) continue;
    // A rule runs until the next rule or the next heading, whichever comes first — without the
    // heading stop, the last rule in a section swallows every section after it.
    const body = p.split(/\n(?=## )/)[0].trimEnd();
    out.push({ id: m[1], body, headline: headlineOf(body) });
  }
  return out;
}

/**
 * Rules present in the repo's copy that bearing did not ship.
 *
 * Matched on the HEADLINE rather than the number: the numbers are exactly what drifted, and a
 * project rule that has since been promoted upstream has the same headline under a different `GP-#`
 * — which is the case that must dedupe, or the harvest comes straight back as a duplicate.
 * @param {string} existing @param {string} shipped
 */
const KEY_WORDS = 6;

/**
 * The first few words of a headline, punctuation stripped — the identity of a rule across rewording.
 *
 * Not the whole headline, and not a string prefix. bearing EXTENDS its own rules: GP-8 grew ", and a
 * command's exit status is the only evidence it worked" onto "Every line you print is a claim." —
 * which changed the FULL STOP INTO A COMMA, so even a prefix test failed and the repo's older copy
 * read as something the project had written. Six words is enough to separate every rule bearing
 * ships (asserted in the suite, so a future rule that collides fails there rather than here).
 */
function key(headline) {
  return headline
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, KEY_WORDS)
    .join(" ");
}

export function localRules(existing, shipped) {
  const mine = new Set(parseRules(shipped).map((r) => key(r.headline)));
  return parseRules(existing).filter((r) => !mine.has(key(r.headline)));
}

/** Exported for the suite: bearing's own rules must stay separable under `key`. */
export function headlineKeys(md) {
  return parseRules(md).map((r) => key(r.headline));
}

/**
 * @param {string|null} existing the repo's current file, or null on a first install
 * @param {string} shipped bearing's file, markers included
 * @returns {{content: string, adopted: string[]}} `adopted` = project rules carried across a
 *   migration, so the installer can say what it moved rather than moving it silently (GP-6).
 */
export function mergeGoldPractices(existing, shipped) {
  if (!existing) return { content: `${shipped}\n${PROJECT_SEED}`, adopted: [] };

  const start = existing.indexOf(GP_BEGIN);
  const end = existing.indexOf(GP_END);
  if (start >= 0 && end > start) {
    // Steady state: swap bearing's block, keep everything the user has below it.
    //
    // The join is NORMALISED rather than concatenated. Splicing the block back in verbatim left
    // bearing's trailing newline against the tail's leading one, so the gap after the END marker
    // grew by a line on EVERY update — invisible for months, then a file with a screen of
    // whitespace in the middle. Idempotence is the contract: update twice, get the same bytes
    // (NS-3). Same defect the .gitignore block shipped with once already (GP-24).
    const head = existing.slice(0, start).replace(/\s+$/, "");
    const tail = existing.slice(end + GP_END.length).replace(/^\s+/, "");
    return {
      content: `${head ? `${head}\n\n` : ""}${shipped.trim()}\n\n${tail}${tail.endsWith("\n") ? "" : "\n"}`,
      adopted: [],
    };
  }

  // MIGRATION — an unmarked file from before this existed. Everything in it that bearing did not
  // ship is the project's, and it is the whole reason this function exists, so it is carried across
  // and renumbered rather than backed up and forgotten. A backup nobody reads is data loss with a
  // receipt (GP-21).
  const local = localRules(existing, shipped);
  if (!local.length) return { content: `${shipped}\n${PROJECT_SEED}`, adopted: [] };

  const carried = local.map((r, i) =>
    r.body.replace(/^- \*\*(?:GP|PP)-\d+\*\*/, `- **PP-${i + 1}**`),
  );
  const seed = PROJECT_SEED.replace(
    "<!-- Add PP-1, PP-2, … here. -->",
    `<!-- Carried over from this repo's own gold-practices when bearing split the file. -->\n\n${carried.join("\n\n")}`,
  );
  return { content: `${shipped}\n${seed}`, adopted: local.map((r) => r.id) };
}
