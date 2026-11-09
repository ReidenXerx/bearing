# Security

## Scope

This repo ships **local agent hooks, skills, and install scripts** for your machine and your git repos. It does not run a hosted service.

## Reporting

For vulnerabilities in **this kit** (install scripts, hook injection, manifest handling):

1. Open a private report via [GitHub Security Advisories](https://github.com/ReidenXerx/bearing/security/advisories/new) if you have access, **or**
2. Email the maintainer with repro steps and impact — do not open a public issue for exploit details.

For **GitNexus core** (indexer, MCP server, graph data), report to the upstream GitNexus project.

## Safe defaults

- Install requires an explicit target path inside a git worktree.
- Hooks only affect Claude Code sessions on projects where the kit is installed. None of them blocks a tool call.
- No credentials are stored in the bundle; wiki scripts expect API keys in your env only.
