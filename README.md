# btch-cli + MCP server + playground

Three front-ends around [`btch-downloader`](https://www.npmjs.com/package/btch-downloader):

- **`example.html`** — single-page playground (the one deployed at https://btch.foo.ng/example.html). Loads the library from jsDelivr and runs entirely in the browser.
- **`cli.js`** (`btch`) — a Node CLI supporting every platform with auto-detect, JSON output, and optional media download.
- **`mcp.mjs`** (`btch-mcp`) — a local **Model Context Protocol** server that lets Claude Code (and any other MCP-compatible client) call the downloader directly.

All three share the same platform registry and harvesting logic in `lib/btch.js`.

## Install

```bash
npm install
npm link        # optional, exposes the `btch` command globally
```

Node 20.18.1+ is required (matches the library's own requirement).

## Web page

Just open `example.html` in a browser, or serve the directory:

```bash
npm run web    # uses npx http-server on :8080
```

Features:
- platform dropdown + auto-detect from any pasted URL
- sample URL list for every supported platform (click to fill)
- result grid that walks the JSON response and surfaces every direct media URL with Download / Open / Copy buttons
- raw JSON pane for debugging
- deep-linkable: `example.html?url=<encoded>&platform=youtube`

## CLI

```bash
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

# Force YouTube search
btch "Somewhere Only We Know" -p yts

# Download all media discovered in an Instagram post
btch https://www.instagram.com/reel/DKPtUL_S9Nh/ -d

# Save just the first media to a specific path
btch https://pin.it/4CVodSq -o ./pin.jpg

# Pipe direct URLs into something else (e.g. yt-dlp, aria2c, curl)
btch https://youtu.be/C8mJ8943X80 --urls | head -1 | xargs curl -L -o video.mp4
```

## MCP server

A local MCP server is exposed as `btch-mcp` (entry point: `mcp.mjs`). It speaks MCP over stdio and registers three tools:

| Tool             | What it does                                                                              |
|------------------|-------------------------------------------------------------------------------------------|
| `list_platforms` | Enumerate every supported platform.                                                       |
| `fetch_media`    | Fetch metadata + direct media URLs for a link or search query. Auto-detects the platform. |
| `download_media` | Same as above, but also writes the discovered files to disk and returns the paths.        |

### Register with Claude Code

```bash
# from anywhere — uses the absolute path to this repo
claude mcp add btch -- node /absolute/path/to/this/repo/mcp.mjs

# verify
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

After restarting the client, you can ask things like *"Use the btch MCP to grab the audio URL from this Spotify link"* or *"Use download_media to save the first item from <tiktok url> into ~/Movies/scratch."*

### Run / debug standalone

```bash
node mcp.mjs                  # starts an MCP stdio server in the current terminal
node scripts/smoke-mcp.mjs    # handshake + tools/list + list_platforms call
node scripts/smoke-mcp-fetch.mjs "Keane" yts   # live fetch_media call
```

stdout is reserved for the MCP transport — startup banners and errors go to stderr so they don't corrupt the protocol stream.

### Supported platforms

`instagram, tiktok, facebook, twitter, youtube, mediafire, capcut, gdrive, pinterest, douyin, xiaohongshu, snackvideo, cocofun, spotify, soundcloud, threads, kuaishou, yts, aio`

All requests hit the upstream API that `btch-downloader` ships with — see the [library README](https://www.npmjs.com/package/btch-downloader) for limitations.
