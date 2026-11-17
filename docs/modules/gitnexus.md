# 🕸 GitNexus

**Grepping a symbol gives 40 text matches and no structure.**

**Opt-in, and you invoke it.** It is not in the default install: the installer explains what it is, what it costs (the `gitnexus` CLI, an index build, a local MCP server) and when it helps, and asks. Once installed, nothing pushes the agent towards it — no gates, no nudges, no always-on instructions. Ask for it in a prompt ("use gitnexus to find what this diff affects") and the `bearing-gitnexus` skill loads: check scope first (the index is one checkout at one commit), where the graph wins, and where its counts are only a floor.

On a large repo, for the questions text search answers badly, the graph earns its keep; that is what the skill is for.

**A coverage limit presented as a fact is the failure this is built to survive.** `impact` can return zero callers for a function wired to a live route, because calls through factories and DI seams don't always resolve. So the contract is asymmetric, and the agent is told so:

> **A positive result is strong evidence. A zero is not a finding.** Never conclude "dead code" from an empty graph result — confirm it classically and say which check you ran.


## 🤖 PR impact report — when you want one

With the GitNexus module, `npm run bearing:ci -- <base>` reports a branch's blast radius per changed symbol, affected flows, security-sensitive paths and import cycles. Run inside a GitHub Actions pull-request job it also posts a sticky PR comment. bearing ships no workflow for it — nothing builds or refreshes the index on a trigger — so wire it into your own CI only if you keep an index there. It **never fails your build** by default: the graph can't distinguish "nothing calls this" from "I couldn't resolve the callers", and a hard block on that fails honest PRs. `GITNEXUS_CI_MODE=block` is opt-in.

---

[← back to the README](../../README.md)
