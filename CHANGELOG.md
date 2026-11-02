# Changelog

All notable changes to mcpmedic are listed here. The format follows Keep a Changelog, and versions follow Semantic Versioning.

## [Unreleased]

### Added

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
