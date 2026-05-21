---
name: btch-download
description: Download videos, audio, and images from 19 social-media platforms — TikTok, YouTube, Instagram, Facebook, Twitter/X, Pinterest, Douyin, Xiaohongshu (RedNote), Threads, Kuaishou, Snackvideo, CocoFun, Spotify, SoundCloud, MediaFire, Google Drive, CapCut, plus YouTube search. Wraps the `btch` CLI in this repo. Trigger when the user mentions 下载视频, 抓视频, 抓音频, 抓图, 提取媒体, 拉视频, download a video/audio/image, save a TikTok / YouTube / Instagram / Douyin / 小红书 post, scrape a social-media link, extract a direct media URL, or pipe a URL into yt-dlp / aria2c / curl.
---

# btch-download

Download direct media (mp4 / mp3 / jpg / …) from social-media URLs using the local `btch` CLI. No API keys required — the upstream parser is bundled.

## When to use this skill

- The user pastes a social-media link (TikTok, YouTube, IG, Douyin, Xiaohongshu, etc.) and wants the file saved locally.
- The user wants the direct media URL of a post (to pipe into another tool like yt-dlp, aria2c, ffmpeg).
- The user wants to search YouTube and grab the first result (`yts` platform).

This skill is **download-only**. For transcript / summary work, hand the downloaded file off to a separate transcription skill or agent.

## Prerequisite

The `btch` CLI must be on `PATH`. From this repo:

```bash
npm install && npm link        # exposes `btch` globally
btch list                      # verify install + see all platforms
```

If `btch` is not on PATH, fall back to `node /absolute/path/to/cli.js …` with the same flags.

## Supported platforms

```
instagram · tiktok · facebook · twitter · youtube · mediafire · capcut ·
gdrive · pinterest · douyin · xiaohongshu · snackvideo · cocofun ·
spotify · soundcloud · threads · kuaishou · yts (YouTube search) · aio
```

Platform is auto-detected from the URL. Non-URL input falls back to `yts` (YouTube search).

## Commands

### 1 · List supported platforms

```bash
btch list
```

### 2 · Inspect a link (default mode — JSON only, no download)

```bash
btch <url-or-query> [-p <platform>]
```

Prints the raw upstream JSON to stdout. Progress + detected platform go to stderr. Use this when the user just wants the metadata or to see what media is available.

### 3 · Print only the direct media URLs (one per line)

```bash
btch <url-or-query> --urls
```

Ideal for piping into other tools:

```bash
btch https://youtu.be/C8mJ8943X80 --urls | head -1 | xargs curl -L -o video.mp4
btch "lofi beats" -p yts --urls | head -1 | xargs yt-dlp
```

### 4 · Download every discovered media into `./downloads/<platform>/`

```bash
btch <url> -d
btch <url> -d --first      # only the first item
```

Files land in `./downloads/<platform>/NN_<title>.<ext>` relative to the current directory.

### 5 · Download just the first media to a specific path

```bash
btch <url> -o ./out/file.mp4
btch https://pin.it/4CVodSq -o ./pin.jpg
```

### 6 · Force a platform when auto-detect is wrong

```bash
btch "Somewhere Only We Know" -p yts        # search instead of treating as URL
btch <ambiguous-url> -p pinterest           # override fallback
```

### Common flags

| Flag | Effect |
|------|--------|
| `-p, --platform <name>` | Force a platform (default: auto-detect). |
| `-d, --download` | Save every discovered media into `./downloads/<platform>/`. |
| `-o, --out <file>` | Save just the first media to `<file>` (implies download). |
| `--first` | With `-d`, fetch only the first media. |
| `--urls` | Print discovered media URLs, one per line (good for piping). |
| `--json` | Print raw JSON response (default). |
| `-q, --quiet` | Hide progress lines. Errors still go to stderr. |

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success. |
| 1 | No arguments supplied (help shown). |
| 2 | Bad flag / unknown platform. |
| 4 | Upstream API request failed (link expired, platform changed format, rate-limited, etc.). |
| 5 | Response contained no downloadable media URL. |
| 6 | Download failed (HTTP error from the CDN, disk full, etc.). |
| 99 | Unhandled exception (full stack printed to stderr). |

Inspect stderr for the human-readable failure reason; do not parse stdout for errors.

## Recipes

**Just get the direct video URL of a TikTok**:
```bash
btch https://www.tiktok.com/@user/video/123 --urls --quiet | head -1
```

**Download the whole Instagram carousel**:
```bash
btch https://www.instagram.com/p/ABC/ -d
ls downloads/instagram/
```

**Grab the audio of a Spotify track preview**:
```bash
btch https://open.spotify.com/track/XYZ -o ./track.mp3
```

**Pipe into ffmpeg for re-encoding**:
```bash
URL=$(btch https://youtu.be/XYZ --urls --quiet | head -1)
ffmpeg -i "$URL" -c:v libx264 -crf 23 out.mp4
```

**Bulk download from a list of URLs**:
```bash
while read url; do btch "$url" -d --first --quiet; done < urls.txt
```

## Output contract for downstream agents

- **stdout** is structured: either JSON (`--json`, default) or one URL per line (`--urls`).
- **stderr** is human-readable progress + errors. Safe to ignore in pipelines.
- When `-d` / `-o` is used, every saved file's path is logged to stderr as `  ✓ <path>`. Grep for those lines if a downstream step needs the saved locations.
- Don't mix `--urls` with `-d` and try to parse both — pick one mode.

## Where the source lives

- CLI entry: `cli.js` (CommonJS, requires Node ≥ 20.18.1).
- Platform registry + harvesting + download helpers: `lib/btch.js`.
- Same library powers the MCP server (`mcp.mjs`) and the browser playground (`example.html`).

When adding a new platform: append to `PLATFORMS` in `lib/btch.js` and the CLI / MCP / `btch list` pick it up automatically.
