# btch

**English** · [简体中文](./README.zh-CN.md)

Three front-ends around the [`btch-downloader`](https://www.npmjs.com/package/btch-downloader) npm package:

| Front-end       | File           | What it is                                                                 |
|-----------------|----------------|----------------------------------------------------------------------------|
| **CLI**         | `cli.js`       | `btch <url-or-query>` — auto-detect, JSON / URL output, optional download. |
| **MCP server**  | `mcp.mjs`      | Local Model Context Protocol stdio server for Claude Code & friends.       |
| **Web page**    | `example.html` | Single-page playground (live: <https://btch.foo.ng/example.html>).         |

The CLI and MCP server share `lib/btch.js` — one platform registry, one harvesting routine. The web page is intentionally standalone and loads the library from jsDelivr.

## Requirements

- Node `>=20.18.1` (matches the upstream library)

## Install

```bash
npm install
npm link        # optional — exposes `btch` and `btch-mcp` globally
```

## Supported platforms

```
instagram · tiktok · facebook · twitter · youtube · mediafire · capcut ·
gdrive · pinterest · douyin · xiaohongshu · snackvideo · cocofun ·
spotify · soundcloud · threads · kuaishou · yts (YouTube search) · aio
```

Run `btch list` or call the MCP `list_platforms` tool to see the registry at runtime.

---

## 1. CLI (`btch`)

```
btch <url-or-query> [options]

  -p, --platform <name>    force a platform (default: auto-detect)
  -d, --download           save discovered media into ./downloads/<platform>/
  -o, --out <file>         save just the first media to <file>
      --first              with -d, only fetch the first media
      --urls               print discovered media URLs only (one per line)
      --json               print raw JSON response (default)
  -q, --quiet              hide progress lines
  -h, --help               help
  btch list                list supported platforms
```

### Examples

```bash
# Auto-detect TikTok and print the raw JSON
btch https://www.tiktok.com/@omagadsus/video/7025456384175017243

# Force a YouTube search
btch "Somewhere Only We Know" -p yts

# Download every media item discovered in an Instagram post
btch https://www.instagram.com/reel/DKPtUL_S9Nh/ -d

# Save just the first media to a specific path
btch https://pin.it/4CVodSq -o ./pin.jpg

# Pipe direct URLs into another tool (yt-dlp, aria2c, curl…)
btch https://youtu.be/C8mJ8943X80 --urls | head -1 | xargs curl -L -o video.mp4
```

---

## 2. MCP server (`btch-mcp`)

A local MCP server over stdio. Registers three tools:

| Tool             | Purpose                                                                                 |
|------------------|------------------------------------------------------------------------------------------|
| `list_platforms` | Enumerate every supported platform.                                                      |
| `fetch_media`    | Fetch metadata + direct media URLs for a link or search query. Auto-detects the platform.|
| `download_media` | Same as `fetch_media`, but also writes the discovered files to disk and returns paths.   |

### Register with Claude Code

```bash
claude mcp add btch -- node /absolute/path/to/this/repo/mcp.mjs
claude mcp list
```

Or add it by hand to `~/.claude.json` / `~/.config/claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "btch": {
      "command": "node",
      "args": ["/absolute/path/to/this/repo/mcp.mjs"]
    }
  }
}
```

After restarting the client you can ask things like:

> *Use the btch MCP to grab the audio URL from this Spotify link.*
>
> *Use `download_media` to save the first item from `<tiktok url>` into `~/Movies/scratch`.*

### Run / debug standalone

```bash
node mcp.mjs                                   # MCP stdio server in the foreground
node scripts/smoke-mcp.mjs                     # handshake + tools/list + list_platforms
node scripts/smoke-mcp-fetch.mjs "Keane" yts   # live fetch_media call
```

> Stdout is reserved for the MCP transport — startup banners and errors are emitted on stderr so they don't corrupt the protocol stream.

---

## 3. Web playground (`example.html`)

Open the file directly in a browser, or serve the directory:

```bash
npm run web    # npx http-server on :8080
```

Features:

- platform dropdown + auto-detect from any pasted URL
- sample URLs per platform (click to fill)
- result grid surfaces every direct media URL with Download / Open / Copy buttons
- raw JSON pane for debugging
- deep-linkable: `example.html?url=<encoded>&platform=youtube`

---

## Project layout

```
cli.js              # CLI entry  (CommonJS)
mcp.mjs             # MCP server (ESM, uses createRequire to load the CJS lib)
lib/btch.js         # shared platform registry, detect(), harvestMedia(), download helpers
example.html        # standalone browser playground (independent of lib/btch.js)
scripts/            # smoke tests for the MCP server
```

All requests hit the upstream API that `btch-downloader` ships with — see the [library README](https://www.npmjs.com/package/btch-downloader) for known limitations.

## License

Apache 2.0 — see [`LICENSE`](./LICENSE).
