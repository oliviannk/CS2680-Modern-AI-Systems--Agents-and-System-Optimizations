# CS2680 Assignment 1 — Claude Code Trajectory Observatory

> **Development Attribution:** This assignment's backend, frontend, fixtures, tests, and documentation were **developed using Google DeepMind Antigravity** (with the `Modern Web Guidance` plugin), **not** developed with Claude Code. The web application itself acts as a pure observer/driver that spawns headless `claude -p --output-format stream-json --verbose` subprocesses (without any agent framework or Agent SDK) or replays recorded `.jsonl` event streams.

A zero-dependency Node.js + Vanilla ES Modules web interface for running and observing headless Claude Code trajectories in real time.

## How to Start the Server

Requires **Node.js >= 20** (verified on Node `v24.14.1`). No `npm install` step is needed.

```bash
cd assignments/assignment1
npm start
# Or directly:
node server.js
```

By default the server binds to `http://127.0.0.1:3456` and pre-fills the working directory with `assignments/assignment1/demo-repo`.

### Optional Environment Variables

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `PORT` | `3456` | HTTP server port |
| `HOST` | `127.0.0.1` | Bind address (`0.0.0.0` if exposing over LAN/CloudLab) |
| `CLAUDE_BIN` | auto-discovered | Explicit path to `claude` CLI (auto-scans `PATH`, `~/.nvm/versions/node/*/bin/claude`, `/opt/homebrew/bin`, `~/.local/bin`) |
| `ACCESS_TOKEN` | unset | When set, rejects requests missing `Authorization: Bearer <token>` or `?token=<token>` |

> **Credential Safety:** Do **not** export `ANTHROPIC_API_KEY` when using a Harvard/subscription Claude Code login; `claude` prioritizes `ANTHROPIC_API_KEY` over stored login credentials. The observatory detects `ANTHROPIC_API_KEY` in the server environment and shows a warning banner in the UI if present.

## Running Tests

```bash
cd assignments/assignment1
npm test
# Runs: node --test test/*.test.js
```

Covers NDJSON ingestion across all three recorded fixtures, 80+ line error output capture, `parent_tool_use_id` subagent nesting, `validateWorkdir`, `buildClaudeArgs`, XSS-safe Markdown rendering, and line-level unified diffs.

## Modes & Features

### Seven Core Assignment Features
1. **Submit a prompt**: Choose a working directory (`demo-repo` and `/bad/path` quick chips included) and launch sequential runs on the same page.
2. **Live trajectory streaming**: Server-Sent Events (`/api/runs/:id/stream`) render assistant Markdown and `tool_use` cards as each NDJSON line arrives.
3. **Tool results with deliberate folding**: Pairs `tool_result` blocks by `tool_use_id`; outputs longer than 8 lines show an 8-line preview with a native `<details>` fold toggle (`▸ N more lines, folded`).
4. **Two-level status**: Per tool call (`● pending` -> `✓ (duration)` / `✕ error` / `■ interrupted`) and per run (`● running · timer`, `✓ finished`, `✕ failed` with explicit error banner, `■ stopped`).
5. **Continue the conversation**: Automatically forwards `session_id` to `--resume <session_id>` on follow-up prompts and folds earlier completed turns to keep context readable.
6. **Run metrics**: Displays cost (`$`), wall-clock duration, turn count, and `session_id` from the final `result` event plus cumulative session totals.
7. **Subagent tree + side-by-side outline**: Nests events carrying `parent_tool_use_id` inside collapsible branches beneath their spawning `Task` call while keeping a sticky **Outline** column alongside the dialogue on wide viewports (`>= 960px`, collapsible drawer below).

### Improvements Beyond the Spec
- **Live `Stop` button** (`SIGTERM` -> `SIGKILL` subprocess cancellation and clean `interrupted` state cleanup).
- **Inline Unified Diffs & Changed Files `<dialog>`** summarizing every `Edit`, `MultiEdit`, and `Write` across a session.
- **Replay Studio** (`1x` / `4x` / `Instant` pacing over `fixtures/*.jsonl`, custom `.jsonl` file import/paste, and `.jsonl` export of any run).
- **Parallel Session Tabs + Outline Search/Filter** (`All`, `Errors`, `Edits`, `Subagents`).
- **Scoped Permission Presets** (`--dangerously-skip-permissions` or customizable `--allowedTools`).

## Directory Layout

- [`server.js`](./server.js) — Zero-dependency HTTP + SSE server and static file handler
- [`lib/claude-runner.js`](./lib/claude-runner.js) — CLI binary discovery, workdir validation, subprocess runner, and `.jsonl` replay engine
- [`public/`](./public/) — `index.html`, `styles.css`, `app.js`, plus shared pure ES modules `public/lib/trajectory-model.js` and `public/lib/markdown.js`
- [`fixtures/`](./fixtures/) — Deterministic `stream-json` test captures (`01-fix-bug.jsonl`, `02-resume-followup.jsonl`, `03-subagent-survey.jsonl`)
- [`demo-repo/`](./demo-repo/) — Self-contained Python target project (`src/parser.py`, `src/cli.py`, `tests/test_parse.py`)
- [`test/assignment1.test.js`](./test/assignment1.test.js) — Automated unit test suite
- [`writeup.md`](./writeup.md) / [`writeup_zh.md`](./writeup_zh.md) — Assignment 1 writeup (English & Chinese)
- [`sessions/`](./sessions/) — Development provenance & session archive notes (noting Antigravity development)
- [`SPEC.md`](./SPEC.md) — Original bilingual Assignment 1 specification (renamed from `readme.md` for APFS case-insensitivity)
