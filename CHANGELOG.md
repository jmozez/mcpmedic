# Changelog

All notable changes to mcpmedic are listed here. The format follows Keep a Changelog, and versions follow Semantic Versioning.

## [Unreleased]

Planned as 0.1.0, the first public release.

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
- 17 static checks of tool definitions: names, descriptions, input schemas, parameters, enums, annotations, duplicates, look-alike names and context cost.
- A token estimate for each tool and for the whole server.
- A text report with a fix for each finding, a score out of 100 and the heaviest tools.
- `--json` output for scripts and CI.
- `--fail-on error|warning|info|never` exit codes, and `--rule` to run one check.
- `mcpmedic rules` lists every check.
- A library entry point, so other tools can call the checks directly.
- Tests, including one against a real stdio server, and CI on Linux and Windows.
