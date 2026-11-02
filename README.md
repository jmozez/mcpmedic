# mcpmedic

[![CI](https://github.com/jmozez/mcpmedic/actions/workflows/ci.yml/badge.svg)](https://github.com/jmozez/mcpmedic/actions/workflows/ci.yml)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)

**Check your MCP server before your users do.**

An MCP server can pass every protocol test and still work badly in practice. Vague descriptions make the model pick the wrong tool, missing parameter details lead to bad arguments, and a bloated tool list eats the context window before the agent does anything useful.

mcpmedic connects to your server, reads its tools, and tells you in plain language what will trip up an AI agent, how to fix it, and how much context each tool costs. It runs on your own machine, needs no account, and sends your data nowhere.

> Status: early development (week 1 of 4). It is not on npm yet. Live probes, host rules, model-based evals and proven fixes are coming next. See the [roadmap](#roadmap).

## What it checks

18 checks today, all static (they read the tool definitions, they do not call your tools):

| Check | Level | What it means |
| --- | --- | --- |
| `no-tools` | error | The server lists at least one tool. |
| `duplicate-name` | error | Tool names are unique. |
| `name-format` | error | Tool names use 1 to 64 letters, digits, underscores, dots or hyphens. |
| `missing-description` | error | Every tool has a description. |
| `short-description` | warning | Descriptions are long enough to choose the tool well. |
| `vague-description` | warning | Descriptions start with what the tool actually does. |
| `long-description` | warning | Descriptions stay under about 1,000 characters. |
| `schema-missing` | error | Every tool has an inputSchema of type object. |
| `required-unknown` | error | Every required field is defined in properties. |
| `param-description` | warning | Every parameter has a description. |
| `param-type` | warning | Every parameter declares a type. |
| `empty-enum` | error | Enums list at least one value. |
| `missing-annotations` | info | Tools say whether they are read-only or destructive. |
| `conflicting-annotations` | error | Annotations do not contradict each other. |
| `heavy-tool` | warning | No single tool costs more than about 800 tokens of context. |
| `heavy-server` | warning | The whole tool list stays under about 10,000 tokens. |
| `many-tools` | info | The server exposes a manageable number of tools. |
| `similar-names` | warning | Tool names are not easily confused. |

Levels: **error** will break or confuse hosts, **warning** will likely hurt tool choice or cost, **info** is good practice.

## Try it

Until the first release, run it from source. You need Node.js 20 or newer.

```bash
git clone https://github.com/jmozez/mcpmedic.git
cd mcpmedic
npm install
npm run build
```

Then point it at a server:

```bash
# A local server that runs over stdio (everything after -- is the server's command)
node dist/cli.js check -- npx -y @modelcontextprotocol/server-everything

# A remote server over Streamable HTTP (falls back to the older SSE transport)
node dist/cli.js check --url https://example.com/mcp --header "Authorization: Bearer $TOKEN"

# A saved tools/list result
node dist/cli.js check --file tools.json
```

Example output:

```text
mcpmedic 0.1.0-dev: MCP server
4 tools, about 171 tokens of context

  error  duplicate-name         search: More than one tool is called "search".
                                fix: Give each tool a unique name.
  error  name-format            do stuff!: The name "do stuff!" will be rejected or renamed by some hosts.
                                fix: Use only A to Z, 0 to 9, underscore, dot or hyphen, up to 64 characters, for example get_weather.
  error  missing-description    Search: The tool has no description, so the model has to guess when to use it.
                                fix: Say what the tool does, when to use it and what it returns, in one or two sentences.
...
```

## Options

```text
Options
  --json                 print the report as JSON
  --fail-on <level>      exit with code 1 at this level or above: error (default), warning, info, never
  --rule <id>            run only this check (repeatable)
  --header "Name: value" add an HTTP header (repeatable), for example an Authorization header
  --env KEY=value        set an environment variable for a stdio server (repeatable)
  --timeout <seconds>    give up after this long (default 30)
  -h, --help             show this help
  -v, --version          show the version
```

Exit codes: 0 means no findings at or above `--fail-on`, 1 means there were, 2 means mcpmedic could not run (bad options or no connection).

## Use it in CI

```yaml
- run: npm ci && npm run build
- run: npx --yes github:jmozez/mcpmedic check --fail-on error -- node dist/server.js
```

A ready-made GitHub Action and a score badge are planned for week 2.

## Use it as a library

```ts
import { snapshot, runRules, buildReport } from "mcpmedic";

const snap = await snapshot({ kind: "stdio", command: "node", args: ["server.js"] });
const report = buildReport(snap, runRules(snap), "0.1.0");
console.log(report.summary.score);
```

## How the score works

Each tool starts at 100. Every error costs 10 points and every warning 3, averaged over the number of tools. Notes cost nothing. The token figures use about 4 characters per token, which is close enough to compare tools but differs a little between models.

## Roadmap

1. **Week 1 (done):** CLI, connections (stdio, Streamable HTTP, SSE, file), static checks, token cost, text and JSON reports, CI.
2. **Week 2:** live probes that call each tool with valid generated input, checks that errors are useful and responses fit host size limits, an open rule pack for each host (Claude, ChatGPT, Cursor, VS Code, Codex, Gemini CLI) with a source link per rule, an HTML report, a GitHub Action and a badge.
3. **Week 3:** tool-choice evals that run on your own model key or a local model, with repeat runs to measure consistency.
4. **Week 4:** fix mode that rewrites weak descriptions and keeps only changes that improve the eval score, SARIF output, and the first public release.

## Contributing

Issues and pull requests are welcome. Run `npm test` before you open a pull request. New checks go in `src/rules/index.ts` with a test in `test/rules.test.ts`.

## Licence

[MIT](LICENSE) © 2026 Dr. Jimmy Moses
