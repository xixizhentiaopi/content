---
name: btch-transcribe
description: Extract a transcript (脚本 / subtitles) from a video or audio file — either from a social-media URL (TikTok / YouTube / Instagram / Douyin / Xiaohongshu / 19 platforms) or a local file path. Runs entirely locally via ffmpeg + open-source Whisper, no API keys. Trigger when the user mentions 提取脚本, 提取字幕, 转写, 听写, 出字幕, 出 srt, 视频转文字, 音频转文字, transcribe a video / audio, generate subtitles, extract a script / transcript, get the text out of a TikTok / YouTube clip, or pipe a downloaded media file through Whisper.
---

# btch-transcribe

Local-only transcript extraction. **No API keys, no cloud calls** — everything runs on the user's machine via:

```
ffmpeg → 16 kHz mono mp3 → whisper CLI → { text, segments, language }
```

## When to use this skill

- The user wants the spoken content of a video as text (transcript, script, captions, subtitles).
- The user wants `.srt` subtitles from a video.
- The user wants to translate non-English audio to English text (Whisper's `translate` task).

For **downloading** without transcription, use [`btch-download`](../btch-download/SKILL.md) instead.

## Prerequisites

Three things must be on `PATH`:

| Tool | Install |
|------|---------|
| `btch` | `npm install && npm link` in this repo |
| `ffmpeg` | `brew install ffmpeg` · `apt install ffmpeg` |
| `whisper` *or* `whisper-ctranslate2` | `pip install -U openai-whisper` · `pip install -U whisper-ctranslate2` |

Override the whisper binary by setting `BTCH_WHISPER_CMD=/path/to/your/whisper`.
Override the default model with `BTCH_WHISPER_MODEL=small`.

If any prerequisite is missing, the CLI prints the exact install command to stderr and exits non-zero.

## Command

```bash
btch transcribe <url|file> [options]
```

Input may be:
- a URL on any platform supported by `btch list` (auto-detected, downloaded to a temp file, then transcribed)
- a local video or audio file path (skips the download step)

When given an audio file (`.mp3 .wav .m4a .flac .ogg .aac`), the ffmpeg step is skipped.

### Options

| Flag | Effect |
|------|--------|
| `--lang <iso>` | Language hint (`en`, `zh`, `ja`, `ko`, …). Omit for auto-detect. |
| `--model <name>` | `tiny` · `base` (default) · `small` · `medium` · `large`. Bigger = better + slower. |
| `--task <kind>` | `transcribe` (default) or `translate` (always outputs English). |
| `--device <dev>` | `cpu` · `cuda` · `mps`. Defaults to whatever whisper picks. |
| `--text` | Output plain text (default). |
| `--srt` | Output SubRip subtitles with timestamps. |
| `--json` | Output the full whisper JSON (`text` + `segments` + `language`). |
| `-s, --save <file>` | Also write the transcript to `<file>`. |
| `--keep-audio` | Keep the intermediate `.mp3` instead of deleting it. |
| `-p, --platform <id>` | Force download platform when the URL is ambiguous. |
| `-q, --quiet` | Suppress progress on stderr. |

## Recipes

**Print transcript of a TikTok**:
```bash
btch transcribe https://www.tiktok.com/@user/video/123 --lang zh
```

**Generate .srt subtitles for a YouTube video**:
```bash
btch transcribe https://youtu.be/XYZ --srt -s subtitles.srt
```

**Transcribe a local interview with the bigger model**:
```bash
btch transcribe ./interview.mp4 --model small --json -s interview.json
```

**Translate Japanese audio to English text**:
```bash
btch transcribe ./jp-clip.mp3 --task translate -s en.txt
```

**Pipe into another agent / LLM for summarization**:
```bash
btch transcribe https://www.bilibili.com/... -q | your-llm-cli summarize
```

**Batch transcribe a folder of mp4s**:
```bash
for f in ./videos/*.mp4; do
  btch transcribe "$f" --srt -s "${f%.mp4}.srt" -q
done
```

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success. |
| 2 | Bad flag / missing input. |
| 4 | Download failed (URL expired, platform broken, etc.). |
| 5 | Upstream API returned no media URL. |
| 7 | Transcription failed (ffmpeg missing, whisper missing, decoding error, …). The exact reason is on stderr. |
| 99 | Unhandled exception. |

## Output contract

- **stdout** holds the transcript body in the requested format (`--text`, `--srt`, or `--json`). Nothing else — safe to redirect to a file.
- **stderr** holds progress, the resolved local path, the whisper CLI's own logs, and any errors. Ignore unless you need to know where the temp audio was extracted.
- `-s <file>` also writes the same body to disk, so a downstream step can either read stdout or open the file.
- Temp downloads live in `$TMPDIR/btch-transcribe-src/<platform>/` and are not cleaned up automatically; remove them yourself if disk pressure matters.

## Where the source lives

- CLI subcommand: `cli.js` → `cmdTranscribe`
- Library: `lib/transcribe.js` (`extractAudio`, `whisperRun`, `transcribeFile`, `toSrt`)
- Same library powers the MCP `transcribe_media` tool in `mcp.mjs`.

This skill is **download + transcription only**. For any summarization, content extraction, key-points, etc., chain the transcript stdout into a separate LLM / agent — the project deliberately does not embed an API client for that.
