# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Three front-ends share one core that wraps the `btch-downloader` npm package:

- `cli.js` (`btch` bin) — CommonJS Node CLI
- `mcp.mjs` (`btch-mcp` bin) — ESM MCP stdio server using `@modelcontextprotocol/sdk`
- `example.html` — standalone browser playground that loads `btch-downloader` from jsDelivr (does NOT use `lib/btch.js`)

The CLI and MCP server both consume `lib/btch.js`. The web page is independent.

Node `>=20.18.1` is required.

## Commands

```bash
npm install
npm link                # expose `btch` and `btch-mcp` globally
npm run start           # node cli.js
npm run mcp             # node mcp.mjs   (MCP stdio server)
npm run web             # http-server on :8080 for example.html

# Smoke tests for the MCP server (no formal test suite):
node scripts/smoke-mcp.mjs                     # handshake + tools/list + list_platforms
node scripts/smoke-mcp-fetch.mjs "Keane" yts   # live fetch_media call
```

There is no lint config and no test runner — the smoke scripts under `scripts/` are the only automated checks.

## Architecture

`lib/btch.js` (CJS) is the single source of truth for:

- `PLATFORMS` — registry mapping a platform `id` to a `btch-downloader` function name (`fn`), an input `kind` (`url` / `query` / `any`), and a detection `regex`.
- `detect(input)` — picks a platform id from a URL; non-URL input falls back to `yts` (YouTube search); unknown URL falls back to `pinterest`.
- `harvestMedia` / `dedupe` — walks the upstream JSON response and pulls out direct media URLs by looking for known keys (`MEDIA_KEYS`) and HTTP(S) values. Adding a new media field generally means appending to `MEDIA_KEYS`, not touching the per-platform code.
- `callPlatform(id, input)` — lazy-requires `btch-downloader` and dispatches to `lib[p.fn](input)`.
- `downloadMany` / `downloadOne` — stream URLs to disk via `fetch` + `node:stream/promises.pipeline`.

When adding a new platform: add an entry to `PLATFORMS` (id, `fn` matching the upstream library export, `kind`, `regex`). The CLI, MCP server, and `list_platforms` tool pick it up automatically.

### MCP server specifics

- Loads the CJS shared lib via `createRequire(import.meta.url)` so `mcp.mjs` can stay ESM.
- Stdout is reserved for the MCP transport — **all logging must go to stderr**, otherwise the protocol stream is corrupted.
- Large upstream JSON is truncated to `MAX_JSON_CHARS` (12k) before being returned inline; the harvested media list is returned in full.
- Tools return both `content[]` text and `structuredContent` for clients that consume the machine-readable channel.
- Registered with Claude Code via `claude mcp add btch -- node /absolute/path/to/mcp.mjs`.

### Web playground

`example.html` re-implements platform detection client-side and calls `btch-downloader` from a jsDelivr ESM bundle. It is intentionally decoupled from `lib/btch.js` so it can be served as a static file. If you change platform support, update both places.
