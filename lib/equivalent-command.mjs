/**
 * The one-line command that repeats an interactive install.
 *
 * The wizard is for the first time. Whoever installs bearing into a second repo already knows the
 * answers, and should not have to walk through eleven explanations to give them again (NS-31). So
 * the wizard ends by printing the command it just ran. Every flag in it is a claim (NS-20): the
 * test runs the printed command and compares what it installs with what the wizard installed.
 */
import { KIT_NAME } from "./constants.mjs";

const shq = (s) => (/^[\w./~@%+=:,-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`);

/**
 * @param {{ target: string, runtime: string, features: string[], stealth?: boolean,
 *   prettierIgnore?: boolean, prettierAsked?: boolean, testOrder?: boolean, quick?: boolean,
 *   mcp?: string|null }} o
 */
export function equivalentCommand(o) {
  const parts = ["npx", KIT_NAME, "install", shq(o.target), "--runtime", o.runtime, "--features", o.features.join(",")];
  if (o.stealth) parts.push("--stealth");
  // Only a question that was asked has an answer worth repeating; an unasked one is the default.
  if (o.prettierAsked) parts.push(o.prettierIgnore ? "--prettierignore" : "--no-prettierignore");
  const graph = o.features.includes("gitnexus");
  if (graph) {
    parts.push(o.testOrder ? "--test-order" : "--no-test-order");
    if (o.quick) parts.push("--quick");
    if (o.mcp) parts.push("--mcp", shq(o.mcp));
  }
  return parts.join(" ");
}
