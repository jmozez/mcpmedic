# Changelog

All notable changes to mcpmedic are listed here. The format follows Keep a Changelog, and versions follow Semantic Versioning.

## [Unreleased]

## [0.1.0] - 2026-11-03

The first public release.

### Security

- Stdio servers get a minimal environment plus `--env` values, so model API keys and CI tokens no longer reach them. `--inherit-env` restores the full environment.
- Control characters, bidi overrides and zero-width characters from servers or models are shown as visible `\u` escapes in text, eval, fix and HTML output, so a server cannot inject terminal escapes.
- New `suspicious-instructions` and `hidden-characters` checks catch tool poisoning in descriptions.
- Fix mode wraps server text in a data block for the rewriting model, and drops rewrites that look injected or run over 600 characters.
- The Action escapes server text in the job summary and turns off glob expansion when it splits `command` and `args`.
- SECURITY.md, CodeQL, Dependabot, and workflow actions pinned to commit SHAs.

### Fixed

- A server that flooded stderr or stalled could make mcpmedic exit 0 with no output. It now drains stderr, keeps its timeout alive, and exits 2 if it stops early.
- `--timeout`, `--rule`, `--host` and `--max-tools` are validated before a server starts. An unknown `--rule` used to run nothing and score 100.
- Stray arguments before `--` are reported instead of ignored.
- `fix --write` refuses to overwrite the `--file` it reads.
- Provider error bodies are put on one line in eval reports.

### Changed

- The npm package is now `@jmozez/mcpmedic`. The command is still `mcpmedic`.

### Added

- The HTML report has a dark mode that follows the system setting.
- README screenshots, rebuilt with `docs/images/make.sh`.
- Live probes with `--probe`, `--probe-all` and `--probe-tool`: valid and invalid calls, timeouts, crashes, unhelpful errors, large responses and output schema checks.
- An open host rule pack in `hosts/hosts.yaml` with a source for every rule, `--host`, `--server-name` and `mcpmedic hosts`.
- `--html` for a self-contained HTML report and `--badge` for a shields.io endpoint badge.
- A GitHub Action with a job summary and a score output.
- `mcpmedic fix`: rewrites weak descriptions with a model and keeps only changes that raise eval accuracy, with `--out` suggestions and a `--write` copy of the tools file.
- `--sarif <file>` writes SARIF 2.1.0 for GitHub code scanning, and the Action has a `sarif` input.
- `mcpmedic eval`: tool-choice evals from a YAML cases file, with repeat runs for accuracy and consistency, on OpenAI, Anthropic, OpenRouter, Ollama, any OpenAI-compatible server, or an offline mock.
- `mcpmedic check` connects to a server and reads every tool from `tools/list`, following pagination.
  - Local servers over stdio: `mcpmedic check -- <command> [args...]`, with `--env KEY=value`.
  - Remote servers over Streamable HTTP, falling back to the older HTTP+SSE transport: `--url`, with `--header`.
  - Saved tool lists: `--file tools.json`, either `{ "tools": [...] }` or a bare array.
- 20 static checks of tool definitions: names, descriptions, input schemas, parameters, enums, annotations, duplicates, look-alike names, context cost and tool poisoning.
- A token estimate for each tool and for the whole server.
- A text report with a fix for each finding, a score out of 100 and the heaviest tools.
- `--json` output for scripts and CI.
- `--fail-on error|warning|info|never` exit codes, and `--rule` to run one check.
- `mcpmedic rules` lists every check.
- A library entry point, so other tools can call the checks directly.
- Tests, including one against a real stdio server, and CI on Linux and Windows.

[Unreleased]: https://github.com/jmozez/mcpmedic/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/jmozez/mcpmedic/releases/tag/v0.1.0
