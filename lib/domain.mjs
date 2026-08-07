/**
 * DOMAIN PERSONA — what kind of expert is reviewing this repository.
 *
 * The product's headline claim is that a trading repo gets reviewed by a quant trader and a
 * payments repo by a ledger engineer, because domain expertise is what catches SEMANTIC wrongness:
 * "this fee is computed on gross, should be net" is invisible to a language-only reviewer.
 *
 * That claim was implemented in exactly one skill. `.bearing/domain.json` appeared in the README
 * and in bearing-microscope, and nowhere else — nothing created it, nothing seeded it, and no other
 * skill, contract or session brief read it. Two consequences:
 *
 *   1. Every review skill except microscope worked as a generic engineer.
 *   2. Microscope re-inferred the domain from scratch on every wave, so wave 2 could adopt a
 *      different persona than wave 1 while folding in wave 1's findings.
 *
 * So the persona is resolved ONCE at install, written to a file the user owns, and injected into
 * the always-on contract where every skill and every session sees it.
 *
 * On being wrong: a confidently wrong persona is worse than a generic one, because it biases every
 * judgment downstream. Inference therefore reports its evidence, falls back to a neutral persona
 * when signals are weak, and the installer prints what it chose so it can be corrected. The file is
 * never overwritten once it exists — it is the user's to edit (NS-1).
 */
import fs from "node:fs";
import path from "node:path";

export const DOMAIN_PATH = ".bearing/domain.json";

/**
 * Signal → domain. Ordered: the first match wins, so put the specific before the generic
 * (a "trading platform API" is a trading repo, not a generic API repo).
 *
 * Each persona names a SENIORITY and a SPECIALISM, because "senior engineer" alone reproduces the
 * generic reviewer this exists to replace.
 */
const DOMAINS = [
  {
    id: "trading",
    persona: "senior quantitative trader and trading-systems engineer",
    // `pnl` and `slippage` are near-unambiguous; `order`/`position` alone are not, so they only
    // count alongside another signal (see scoring below).
    strong: /\b(backtest|slippage|pnl|order book|orderbook|market data|candlestick|ohlcv|quant|alpha signal|take profit|stop loss)\b/i,
    weak: /\b(trading|trade|exchange|broker|portfolio|position|ticker|binance|kraken|futures|derivative)\b/i,
  },
  {
    id: "payments",
    persona: "staff payments and ledger engineer",
    strong: /\b(double[- ]entry|ledger|chargeback|settlement|reconcil\w+|payout|interchange|pci[- ]dss)\b/i,
    weak: /\b(payment|invoice|billing|stripe|checkout|refund|subscription|currency)\b/i,
  },
  {
    id: "healthcare",
    persona: "clinical systems engineer with HIPAA and patient-safety expertise",
    strong: /\b(hipaa|phi\b|fhir|hl7|icd-?10|ehr|emr|clinical trial)\b/i,
    weak: /\b(patient|clinic|clinical|medical|health|diagnos\w+|prescription|provider)\b/i,
  },
  {
    id: "identity",
    persona: "staff identity and access-management engineer",
    strong: /\b(oauth2?|oidc|saml|jwt|mfa|scim|refresh token|access token)\b/i,
    weak: /\b(auth\w*|identity|login|session|permission|rbac|tenant)\b/i,
  },
  {
    id: "ml",
    persona: "senior ML systems engineer",
    strong: /\b(embedding|fine[- ]tun\w+|inference server|training loop|vector (db|store|index)|rag\b|prompt engineering)\b/i,
    weak: /\b(machine learning|\bml\b|model|dataset|llm|neural|pytorch|tensorflow|openai|anthropic)\b/i,
  },
  {
    id: "infrastructure",
    persona: "staff platform and reliability engineer",
    strong: /\b(kubernetes|terraform|helm|service mesh|autoscal\w+|sre\b|observability)\b/i,
    weak: /\b(infra\w*|deploy\w*|docker|cluster|provision\w*|pipeline|ci\/cd)\b/i,
  },
  {
    id: "developer-tooling",
    persona: "senior developer-tooling engineer",
    strong:
      /\b(language server|code[- ](graph|index|review)|static analysis|ast\b|linter|codemod|mcp\b|developer[- ]tools?|context[- ]engineering|agentic[- ]ai)\b/i,
    weak: /\b(devtool|scaffold\w*|generator|compiler|parser|agent|editor|\bcli\b)\b/i,
  },
  {
    id: "e-commerce",
    persona: "senior commerce-platform engineer",
    strong: /\b(shopping cart|product catalog|fulfil?lment|sku\b|merchandis\w+)\b/i,
    weak: /\b(ecommerce|e-commerce|storefront|shop|inventory|order management)\b/i,
  },
  {
    id: "data-acquisition",
    persona: "senior data-acquisition and pipeline engineer",
    strong: /\b(web scrap\w+|crawler|etl\b|data pipeline|ingest\w+ pipeline)\b/i,
    weak: /\b(scrape\w*|crawl\w*|lead gen\w*|enrich\w*|dataset build)\b/i,
  },
];

/** The honest default: a real seniority, no invented specialism. */
export const NEUTRAL_PERSONA = "senior software engineer experienced in this project's stack";

/** Read up to `n` bytes of a text file, lowercased. Missing/unreadable → "". */
function readText(root, rel, n = 8000) {
  try {
    return fs.readFileSync(path.join(root, rel), "utf8").slice(0, n).toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Infer the domain from what the repository says about itself.
 *
 * Deliberately reads only self-descriptions — package metadata, README, CLAUDE.md — rather than
 * scanning source. Source scanning finds the vocabulary of whatever library is in fashion; a
 * project's own description is what its authors think it IS.
 *
 * @param {string} root
 * @returns {{ domain: string|null, persona: string, confidence: 'high'|'low'|'none', evidence: string[] }}
 */
export function inferDomain(root) {
  /** @type {Record<string,string>} */
  const sources = {};
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    sources["package.json"] = [
      pkg.name,
      pkg.description,
      ...(pkg.keywords ?? []),
      ...Object.keys(pkg.dependencies ?? {}),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  } catch {
    /* no package.json — other sources still apply */
  }
  sources["README.md"] = readText(root, "README.md");
  sources["CLAUDE.md"] = readText(root, "CLAUDE.md", 4000);

  let best = null;
  for (const d of DOMAINS) {
    const evidence = [];
    let score = 0;
    let declared = false; // a strong signal in the package's OWN metadata
    let anyStrong = false; // an unambiguous term anywhere (HIPAA, double-entry, order book…)
    for (const [name, text] of Object.entries(sources)) {
      if (!text) continue;
      const s = text.match(d.strong);
      const w = text.match(d.weak);
      // package.json name/description/keywords are the authors DECLARING what this is. README prose
      // merely discusses things — including other domains, as examples. Weighting them equally made
      // this repo classify as "trading" purely because its README explains the feature using a
      // trading example, which would then have written "quantitative trader" into its own contract.
      const weight = name === "package.json" ? 2 : 1;
      if (s) {
        score += 2 * weight;
        anyStrong = true;
        if (name === "package.json") declared = true;
        evidence.push(`${name}: "${s[0]}"`);
      } else if (w) {
        score += weight;
        evidence.push(`${name}: "${w[0]}"`);
      }
    }
    if (score >= 2 && (!best || score > best.score)) best = { ...d, score, declared, anyStrong, evidence };
  }

  if (!best) {
    return { domain: null, persona: NEUTRAL_PERSONA, confidence: "none", evidence: [], suggested: null };
  }
  // Confident only when the repo says so itself, or when two independent sources agree strongly.
  // Confident when the repo declares it, or when an unambiguous term (HIPAA, double-entry, order
  // book) appears AND is corroborated. A single strong term in prose is not enough on its own — a
  // doc that merely discusses a domain must not brand the repo as that domain.
  const confident = best.declared || (best.anyStrong && best.score >= 4);
  if (!confident) {
    // Keep the guess visible so the user can accept it in one edit, but do NOT adopt it: a wrong
    // specialism skews every judgement downstream, and "senior engineer" at least skews nothing.
    return {
      domain: null,
      persona: NEUTRAL_PERSONA,
      confidence: "low",
      evidence: best.evidence.slice(0, 3),
      suggested: best.id,
    };
  }
  return {
    domain: best.id,
    persona: best.persona,
    confidence: "high",
    evidence: best.evidence.slice(0, 3),
    suggested: null,
  };
}

/** @param {string} root @returns {{domain:string|null,persona:string}|null} */
export function readDomain(root) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(root, DOMAIN_PATH), "utf8"));
    if (typeof d?.persona === "string" && d.persona.trim()) return d;
  } catch {
    /* absent or malformed → caller infers */
  }
  return null;
}

/**
 * Resolve the persona for this repo, writing the file on first install.
 *
 * NEVER overwrites: once the file exists it is the user's, and silently replacing a persona they
 * corrected would be the same class of bug as reverting their hooks.json (NS-1). Returns what was
 * resolved plus whether it was newly written, so the installer can show it for correction.
 *
 * @param {string} root
 * @returns {{ domain: string|null, persona: string, confidence: string, evidence: string[], created: boolean, source: 'file'|'inferred' }}
 */
export function ensureDomain(root) {
  const existing = readDomain(root);
  if (existing) {
    return {
      domain: existing.domain ?? null,
      persona: existing.persona,
      confidence: existing.confidence ?? "pinned",
      evidence: [],
      created: false,
      source: "file",
    };
  }
  const inferred = inferDomain(root);
  const body = {
    // Written for a human to edit: the comment is part of the contract with the user.
    _comment:
      "Domain persona adopted by bearing's review skills and injected into the always-on contract. " +
      "Edit `persona` to anything you like — bearing never overwrites this file once it exists.",
    domain: inferred.domain,
    persona: inferred.persona,
    confidence: inferred.confidence,
    inferredFrom: inferred.evidence,
    // Present only when the signals leaned somewhere but not far enough to adopt. Named so the
    // user can accept the guess by moving it into `persona`, rather than having it imposed.
    ...(inferred.suggested
      ? {
          suggestedDomain: inferred.suggested,
          _suggestion: `Signals hinted at "${inferred.suggested}" but not strongly enough to adopt it. If that is right, set persona accordingly.`,
        }
      : {}),
  };
  try {
    fs.mkdirSync(path.join(root, path.dirname(DOMAIN_PATH)), { recursive: true });
    fs.writeFileSync(path.join(root, DOMAIN_PATH), JSON.stringify(body, null, 2) + "\n");
  } catch {
    // Not fatal: the skills fall back to inferring at runtime, which is the old behaviour.
    return { ...inferred, created: false, source: "inferred" };
  }
  return { ...inferred, created: true, source: "inferred" };
}
