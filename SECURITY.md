# Security policy

## Supported versions

Security fixes go into the latest release on npm (`@jmozez/mcpmedic`) and the latest tag of the GitHub Action.

## Reporting a vulnerability

Please report it privately through [GitHub private vulnerability reporting](https://github.com/jmozez/mcpmedic/security/advisories/new). Do not open a public issue. You should hear back within a week. Once a fix is released, the advisory will credit you if you would like.

## Threat model

mcpmedic connects to MCP servers that may be broken or hostile. It treats everything a server sends as untrusted:

| Risk | What mcpmedic does |
| --- | --- |
| Terminal escape injection in names, descriptions or errors | Control characters, bidi overrides and zero-width characters are shown as visible `\u` escapes in text, eval and fix output. |
| HTML or script injection in reports | The HTML report escapes all server text, has no scripts and no external resources. SARIF and JSON are built with `JSON.stringify`. |
| Markdown injection in the Action's job summary | Server text is escaped before it is written to the summary. |
| Tool poisoning (hidden orders to the model) | The `suspicious-instructions` and `hidden-characters` rules report it. Fix mode wraps server text in a data block, tells the model never to follow it, and drops rewrites that look injected or run over 600 characters. |
| API keys reaching the server | Stdio servers get a minimal environment plus `--env` values, as MCP hosts do. `--inherit-env` opts in to the full environment. Keys are never written to reports. |
| Header leakage over redirects | HTTP connections refuse cross-origin redirects, so `--header` values only go to the URL you gave. |
| Slow, silent or hanging servers | Every connection and call has a timeout (`--timeout`). The server's stderr is drained so it cannot block. If the process would stop early, it exits 2 instead of 0. |
| Malformed or huge JSON-RPC | The MCP SDK rejects bad messages. A broken call is reported as a failure, not a crash. |
| YAML bombs and unsafe tags in cases files | The `yaml` parser limits aliases and has no tags that run code. |
| Shell injection through Action inputs | Inputs reach the script only as environment variables, never as `${{ }}` text in the script. Word splitting has globbing turned off. Dependencies install with `npm ci --ignore-scripts` from the lockfile. |

**Not a vulnerability:**
- `--probe-all`, which calls tools that can change things. Only use it on a test server.
- Paths you pass to `--out`, `--write`, `--html`, `--badge` and `--sarif`. They are written where you ask, as with any CLI.
- A stdio server command can run anything, because you choose what to start.
