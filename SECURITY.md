# Security policy

## Reporting a vulnerability
**Do not open a public issue.** Use GitHub's *Report a vulnerability* (private security advisories) on this repository. Include: affected version, platform, steps to reproduce, impact, and whether you want credit. Do not include real tokens or personal configuration.

We aim to acknowledge within 5 working days, give an assessment within 14 days, and ship a fix or mitigation as soon as is practical, coordinating disclosure with you. Please allow a reasonable time before public disclosure.

## Supported versions
Only the latest release receives security fixes.

## Scope
In scope: the Electron app and its core library: the renderer/preload/main boundary, IPC validation, path handling and archive extraction, backup/restore, secret handling, MCP process handling, and anything that lets third-party content execute or escape its sandbox.
Out of scope: vulnerabilities in Claude Code, Claude Desktop, Anthropic services, GitHub, or in MCP servers you choose to run; social engineering; issues requiring an already-compromised machine.

## Design and known gaps
See `docs/SECURITY_MODEL.md` and `docs/THREAT_MODEL.md`. Known gaps are listed honestly there, including: builds are not code-signed or notarized, organization-catalog signatures are displayed but not verified, and the static scanner is advisory only.

## Safe harbor
Good-faith research that avoids privacy violations, data destruction and service disruption, and follows this policy, will not be pursued by the maintainers.
