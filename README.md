# btch

**English** · [简体中文](./README.zh-CN.md)

Three front-ends around the [`btch-downloader`](https://www.npmjs.com/package/btch-downloader) npm package, plus a local-only transcript extractor (ffmpeg + Whisper, no API keys).

| Front-end       | File           | What it is                                                                 |
|-----------------|----------------|----------------------------------------------------------------------------|
| **CLI**         | `cli.js`       | `btch <url-or-query>` — auto-detect, JSON / URL output, optional download. Plus `btch transcribe` for ffmpeg + Whisper. |
| **MCP server**  | `mcp.mjs`      | Local Model Context Protocol stdio server. Tools: `list_platforms`, `fetch_media`, `download_media`, `transcribe_media`. |
| **Web page**    | `example.html` | Single-page playground (live: <https://btch.foo.ng/example.html>). In-browser transcription via [transformers.js](https://huggingface.co/docs/transformers.js). |

The CLI and MCP server share `lib/btch.js` and `lib/transcribe.js`. The web page is standalone and loads everything from CDN.

A `skills/` folder bundles ready-to-use [Claude Code skills](#skills) so other agents can drive the CLI without prompt-engineering.

## Requirements

- **Node `>=20.18.1`** (matches the upstream library) — required for everything.
- **ffmpeg** — required only for `btch transcribe`. Install: `brew install ffmpeg` (macOS) / `apt install ffmpeg` (Linux).
- **A local Whisper CLI** — required only for `btch transcribe`. See [Install Whisper](#install-whisper) below.

## Install

```bash
npm install
npm link        # optional — exposes `btch` and `btch-mcp` globally
```

### Install Whisper

Pick whichever fits your machine. The CLI auto-detects `whisper` and `whisper-ctranslate2` on `PATH`; for anything else (e.g. `mlx_whisper`), set `BTCH_WHISPER_CMD`.

| Backend | Best for | Install |
|---------|----------|---------|
| **`mlx-whisper`** ⭐ | **Apple Silicon (M1–M4)** — uses MLX, GPU + Neural Engine + unified memory. Fastest on Mac. | `pip install -U mlx-whisper` then `export BTCH_WHISPER_CMD=mlx_whisper` |
| `whisper-ctranslate2` | Cross-platform CPU. Solid speed everywhere, no GPU needed. | `pip install -U whisper-ctranslate2` |
| `openai-whisper` | Reference implementation. CUDA on NVIDIA. Slowest on macOS (PyTorch MPS is half-baked). | `pip install -U openai-whisper` |
| `whisper.cpp` | Lowest dependencies, Metal-accelerated on Mac. Custom CLI — needs adaptation. | `brew install whisper-cpp`, then point `BTCH_WHISPER_CMD` at a wrapper script |

Default model is `base`. Override per-call with `--model small` or globally via `BTCH_WHISPER_MODEL=small`. For `mlx-whisper`, short names (`tiny`, `base`, `small`, `medium`, `large`, `tiny.en`, …) are auto-mapped to the matching `mlx-community/whisper-*-mlx` HuggingFace repo; pass a full repo path to override.

#### macOS install crib (Apple Silicon)

```bash
brew install ffmpeg                          # if you don't have it
pip3 install --user -U mlx-whisper           # installs to ~/Library/Python/<ver>/bin
```

Make `mlx_whisper` discoverable — pick one:

```bash
# Option A — add the user-site bin to PATH (persistent)
echo 'export PATH="$HOME/Library/Python/3.10/bin:$PATH"' >> ~/.zshrc
echo 'export BTCH_WHISPER_CMD=mlx_whisper' >> ~/.zshrc
source ~/.zshrc

# Option B — keep PATH alone and use the absolute path
echo 'export BTCH_WHISPER_CMD="$HOME/Library/Python/3.10/bin/mlx_whisper"' >> ~/.zshrc
source ~/.zshrc
```

Quick smoke test (downloads ~75 MB on first run):

```bash
ffmpeg -f lavfi -i "sine=frequency=440:duration=2" -ar 16000 -ac 1 /tmp/t.wav -y
btch transcribe /tmp/t.wav --json
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
btch <url-or-query> [options]              # fetch / download (default)
btch transcribe <url|file> [options]        # ffmpeg + local Whisper
btch list                                   # list supported platforms

Download options:
  -p, --platform <name>    force a platform (default: auto-detect)
  -d, --download           save discovered media into ./downloads/<platform>/
  -o, --out <file>         save just the first media to <file>
      --first              with -d, only fetch the first media
      --urls               print discovered media URLs only (one per line)
      --json               print raw JSON response (default)
  -q, --quiet              hide progress lines

Transcribe options:
      --lang <iso>         language hint (en, zh, ja, …) — auto if omitted
      --model <name>       tiny | base | small | medium | large (default: base)
      --task <kind>        transcribe (default) or translate (→ English)
      --device <dev>       cpu | cuda | mps (ignored for mlx-whisper)
      --text               plain text output (default)
      --json               full whisper JSON (text + segments)
      --srt                SubRip subtitles with timestamps
  -s, --save <file>        also write transcript to <file>
      --keep-audio         keep the intermediate .mp3
```

### Examples — download

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

### Examples — transcribe

```bash
# Print transcript of a TikTok in Chinese
btch transcribe https://www.tiktok.com/@user/video/123 --lang zh

# Generate .srt subtitles for a YouTube video
btch transcribe https://youtu.be/XYZ --srt -s subtitles.srt

# Transcribe a local interview with the bigger model
btch transcribe ./interview.mp4 --model small --json -s interview.json

# Translate Japanese audio → English text
btch transcribe ./jp-clip.mp3 --task translate -s en.txt

# Pipe into another LLM / agent for summarization
btch transcribe https://youtu.be/XYZ -q | your-llm-cli summarize
```

---

## 2. MCP server (`btch-mcp`)

A local MCP server over stdio. Registers four tools:

| Tool                | Purpose                                                                                       |
|---------------------|-----------------------------------------------------------------------------------------------|
| `list_platforms`    | Enumerate every supported platform.                                                            |
| `fetch_media`       | Fetch metadata + direct media URLs for a link or search query. Auto-detects the platform.      |
| `download_media`    | Same as `fetch_media`, but also writes the discovered files to disk and returns paths.         |
| `transcribe_media`  | URL or local file → ffmpeg → local Whisper → `{ text, segments, language }` (text / srt / json). |

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

Serve the directory (recommended — `file://` origins can't do cross-origin fetches at all):

```bash
npm run web    # npx http-server on :8080
```

Features:

- platform dropdown + auto-detect from any pasted URL
- sample URLs per platform (click to fill)
- result grid: every direct media URL with **save / open / copy / script** buttons
- **in-browser Whisper transcription** via `@huggingface/transformers` — no API key, model cached in IndexedDB after first download (~75 MB for `tiny`)
- transcript output supports copy / `.txt` / `.srt` downloads with timestamps
- file-picker fallback for CORS-blocked CDNs (most social-media URLs): clicking `script` auto-triggers a normal download, then asks you to drop the file into the picker
- raw JSON pane for debugging
- deep-linkable: `example.html?url=<encoded>&platform=youtube`

Models offered: `whisper-tiny` (default) · `whisper-base` · `whisper-small` · `whisper-tiny.en`.

---

## Skills

`skills/` ships ready-to-use [Claude Code skills](https://docs.anthropic.com/) so other agents can drive the CLI without you re-explaining it each time:

| Skill | Activates on |
|-------|--------------|
| [`btch-download`](./skills/btch-download/SKILL.md) | 下载视频, 抓视频, 抓图, 提取媒体, save a TikTok / YouTube / Instagram link, scrape a social-media post, extract a direct media URL, … |
| [`btch-transcribe`](./skills/btch-transcribe/SKILL.md) | 提取脚本, 提取字幕, 转写, 出 srt, transcribe a video / audio, generate subtitles, get the text out of a video, … |

Install (user-wide):

```bash
ln -s "$(pwd)/skills/btch-download"  ~/.claude/skills/btch-download
ln -s "$(pwd)/skills/btch-transcribe" ~/.claude/skills/btch-transcribe
```

Claude Code picks them up automatically when the user's request matches the triggers in each skill's frontmatter `description`.

---

## Project layout

```
cli.js              # CLI entry  (CommonJS) — default mode + `transcribe` subcommand
mcp.mjs             # MCP server (ESM, uses createRequire to load CJS shared libs)
lib/btch.js         # shared platform registry, detect(), harvestMedia(), download helpers
lib/transcribe.js   # ffmpeg + local Whisper shell-out (mlx / openai / ct2)
example.html        # standalone browser playground (in-browser Whisper via transformers.js)
scripts/            # smoke tests for the MCP server
skills/             # Claude Code skill bundles (download + transcribe)
```

All media-fetch requests hit the upstream API that `btch-downloader` ships with — see the [library README](https://www.npmjs.com/package/btch-downloader) for known limitations. All transcription runs locally on your machine (CLI/MCP) or in your browser (web playground).

## License

Apache 2.0 — see [`LICENSE`](./LICENSE).
