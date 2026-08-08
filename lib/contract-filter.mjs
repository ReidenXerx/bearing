/**
 * FEATURE-FILTER the always-on contract (CLAUDE.md / AGENTS.md / the Cursor rule).
 *
 * The contract is authored once (scripts/contract/) and rendered into per-runtime templates, so it
 * describes the WHOLE product. Written verbatim into a repo that installed only some modules, it
 * instructs the agent to use tools and npm scripts that are not there — the exact failure NS-13
 * exists to prevent, and one an agent cannot detect from inside: the contract reads authoritative.
 *
 * Sections carry an ownership tag on the line above the heading:
 *
 *     <!-- feature: gitnexus -->
 *     ## Stale loop (mandatory)
 *
 * A tagged section ships only when its feature is selected. An untagged section is core and always
 * ships. Tags are HTML comments, so they are invisible wherever markdown is rendered and the
 * templates stay readable as ordinary docs.
 *
 * A tag on a line that is NOT a heading applies to that PARAGRAPH instead, up to the next blank
 * line. Section granularity alone could not express a sentence inside a core section that only
 * makes sense with a feature installed — the north-stars section disambiguated itself against "the
 * graph-first North star above", which in an intel-only repo is a pointer to a section the filter
 * had just removed.
 */

const TAG_RE = /^<!--\s*feature:\s*([a-z]+)\s*-->\s*$/i;

/**
 * @param {string} md contract markdown, possibly carrying `<!-- feature: X -->` tags
 * @param {Set<string>|null} features enabled feature ids; null = keep everything (back-compat)
 * @returns {string} markdown with unselected sections removed and all tags stripped
 */
export function filterContractByFeatures(md, features = null) {
  const lines = md.split("\n");
  const out = [];
  // A tag applies to the section it introduces: from its heading up to the next heading of the
  // same-or-shallower depth. Nesting matters — dropping `## Graph` must also drop its `### When to
  // escalate` subsection, which carries no tag of its own.
  let dropDepth = 0; // 0 = keeping; otherwise the depth of the heading being dropped
  let dropPara = false; // inside a tagged paragraph being dropped
  let pending = null;

  for (const line of lines) {
    const tag = line.match(TAG_RE);
    if (tag) {
      pending = tag[1].toLowerCase();
      continue; // never emit the tag itself
    }
    const heading = line.match(/^(#{1,6})\s/);
    if (heading) {
      dropPara = false; // a heading ends any paragraph
      const depth = heading[1].length;
      if (dropDepth && depth <= dropDepth) dropDepth = 0; // section ended
      if (pending && features && !features.has(pending)) dropDepth = depth;
      pending = null;
    } else if (pending) {
      // Tag introduced a paragraph rather than a section. A tag followed by a BLANK line is an
      // authoring slip with no obvious target — keep the text, since silently deleting the wrong
      // paragraph is the worse failure.
      if (line.trim() && features && !features.has(pending)) dropPara = true;
      pending = null;
    }
    if (dropPara && !line.trim()) {
      dropPara = false; // blank line closes the paragraph
      continue;
    }
    if (!dropDepth && !dropPara) out.push(line);
  }

  // Dropping sections leaves runs of blank lines behind; collapse them so the result reads like a
  // document that was written this way rather than one something was cut out of.
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Does this contract still say anything once filtered? An all-core install could in principle
 * filter down to nothing, and writing an empty CLAUDE.md is worse than writing none.
 * @param {string} md
 */
export function contractIsEmpty(md) {
  return !md.replace(/^#.*$/gm, "").trim();
}
