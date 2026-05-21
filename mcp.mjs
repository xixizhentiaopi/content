#!/usr/bin/env node
/**
 * btch-mcp — Model Context Protocol server for `btch-downloader`.
 *
 * Speaks MCP over stdio. Exposes three tools:
 *
 *   list_platforms   - enumerate every supported platform.
 *   fetch_media      - fetch metadata + direct media URLs for a link/query.
 *   download_media   - same, but also writes the discovered media to disk.
 *
 * Register in Claude Code via:
 *   claude mcp add btch -- node /absolute/path/to/mcp.mjs
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// The shared lib is CJS; load it through createRequire so this file stays ESM.
const require = createRequire(import.meta.url);
const {
  PLATFORMS,
  PLATFORM_IDS,
  detect,
  callPlatform,
  harvestMedia,
  dedupe,
  downloadOne,
  downloadMany,
  sanitize,
  guessExt,
} = require('./lib/btch.js');
const { transcribeFile, toSrt } = require('./lib/transcribe.js');
const fs = require('node:fs');
const os = require('node:os');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Big payloads from the upstream API choke MCP clients. Truncate JSON we
// return inline; the discovered media list stays in full because it's small.
const MAX_JSON_CHARS = 12_000;

function clampJson(value) {
  const json = JSON.stringify(value, null, 2);
  if (json.length <= MAX_JSON_CHARS) return { json, truncated: false };
  return {
    json: json.slice(0, MAX_JSON_CHARS) + `\n… [truncated, ${json.length - MAX_JSON_CHARS} more chars]`,
    truncated: true,
  };
}

function asText(text) {
  return { content: [{ type: 'text', text }] };
}
function asError(text) {
  return { content: [{ type: 'text', text }], isError: true };
}

const server = new McpServer({
  name: 'btch-downloader',
  version: '0.1.0',
});

// ---------------------------------------------------------------------------
// list_platforms
// ---------------------------------------------------------------------------
server.tool(
  'list_platforms',
  'List every social/media platform this server can pull from. Returns id, library function name, and accepted input kind (url, query, or any).',
  {},
  async () => {
    const rows = PLATFORMS.map((p, i) => {
      const idx = String(i + 1).padStart(2, '0');
      return `${idx}. ${p.id.padEnd(12)} → btch.${p.fn.padEnd(11)} (${p.kind})`;
    });
    const summary = [
      `${PLATFORMS.length} platforms supported:`,
      '',
      ...rows,
      '',
      'Pass any `id` above as the `platform` argument of fetch_media / download_media.',
      'Omit `platform` to let the server auto-detect from the URL.',
    ].join('\n');
    return asText(summary);
  }
);

// ---------------------------------------------------------------------------
// fetch_media
// ---------------------------------------------------------------------------
const fetchMediaSchema = {
  input: z
    .string()
    .min(1)
    .describe('A URL (Instagram, TikTok, YouTube, Douyin, Xiaohongshu, etc.) or, for `yts`, a search query.'),
  platform: z
    .enum(PLATFORM_IDS)
    .optional()
    .describe('Override the platform. Omit to auto-detect from the URL.'),
  include_raw: z
    .boolean()
    .optional()
    .default(true)
    .describe('If true (default), include the upstream JSON response. Set false to keep responses small.'),
};

server.tool(
  'fetch_media',
  'Fetch media metadata and direct download URLs for a link or search query. Auto-detects the platform from the URL; falls back to YouTube Search (`yts`) when the input is not a URL.',
  fetchMediaSchema,
  async ({ input, platform, include_raw = true }) => {
    const platformId = platform || detect(input);
    let data;
    try {
      data = await callPlatform(platformId, input);
    } catch (err) {
      return asError(`Upstream request failed (${platformId}): ${err && err.message ? err.message : err}`);
    }

    const media = dedupe(harvestMedia(data, [], ''));
    const summary = {
      detected_platform: platformId,
      media_count: media.length,
      media,
    };

    const lines = [
      `Platform: ${platformId}`,
      `Media found: ${media.length}`,
      '',
    ];
    if (media.length) {
      lines.push('Discovered media:');
      media.forEach((m, i) => {
        lines.push(`  ${String(i + 1).padStart(2, '0')}. [${m.kind}] ${m.title.slice(0, 60)}`);
        lines.push(`      ${m.url}`);
      });
    } else {
      lines.push('No direct media URL detected. See raw JSON below.');
    }

    if (include_raw) {
      const { json, truncated } = clampJson(data);
      lines.push('', '── raw response ──', json);
      if (truncated) lines.push('(raw response truncated for token budget)');
    }

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
      // Machine-readable side channel for clients that consume structuredContent.
      structuredContent: summary,
    };
  }
);

// ---------------------------------------------------------------------------
// download_media
// ---------------------------------------------------------------------------
const downloadSchema = {
  input: z.string().min(1).describe('URL or search query to fetch first.'),
  platform: z.enum(PLATFORM_IDS).optional().describe('Override platform; omit to auto-detect.'),
  out_dir: z
    .string()
    .optional()
    .describe('Directory to save into. Defaults to ./downloads/<platform> relative to the server cwd.'),
  first: z
    .boolean()
    .optional()
    .default(false)
    .describe('If true, only save the first discovered media item.'),
};

server.tool(
  'download_media',
  'Fetch a URL/query, then save every discovered media file to disk. Returns the saved paths. Use `first: true` to grab just the top item.',
  downloadSchema,
  async ({ input, platform, out_dir, first = false }) => {
    const platformId = platform || detect(input);
    let data;
    try {
      data = await callPlatform(platformId, input);
    } catch (err) {
      return asError(`Upstream request failed (${platformId}): ${err && err.message ? err.message : err}`);
    }

    const media = dedupe(harvestMedia(data, [], ''));
    if (!media.length) {
      return asError(`No downloadable media URL found in the ${platformId} response.`);
    }

    const baseDir = out_dir
      ? path.resolve(out_dir)
      : path.resolve(process.cwd(), 'downloads', platformId);

    const saved = await downloadMany(media, baseDir, { first });
    const ok = saved.filter((s) => s.ok);
    const fail = saved.filter((s) => !s.ok);

    const lines = [
      `Platform: ${platformId}`,
      `Saved: ${ok.length} / ${saved.length}  →  ${baseDir}`,
      '',
    ];
    saved.forEach((s, i) => {
      const idx = String(i + 1).padStart(2, '0');
      lines.push(s.ok
        ? `  ✓ ${idx}  [${s.kind}]  ${s.path}`
        : `  ✗ ${idx}  [${s.kind}]  ${s.error}  (${s.url})`);
    });

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
      structuredContent: {
        platform: platformId,
        out_dir: baseDir,
        saved: ok,
        failed: fail,
      },
      isError: ok.length === 0,
    };
  }
);

// ---------------------------------------------------------------------------
// transcribe_media
// ---------------------------------------------------------------------------
function isLocalFile(s) {
  try { return fs.existsSync(s) && fs.statSync(s).isFile(); }
  catch { return false; }
}

async function resolveMediaForTranscript(input, platformOverride) {
  if (isLocalFile(input)) return { localPath: input, downloaded: false };
  const platformId = platformOverride || detect(input);
  const data = await callPlatform(platformId, input);
  const media = dedupe(harvestMedia(data, [], ''));
  if (!media.length) throw new Error(`no downloadable media URL in the ${platformId} response`);
  const primary = media.find((m) => m.kind === 'video') || media.find((m) => m.kind === 'audio') || media[0];
  const outDir = path.join(os.tmpdir(), 'btch-transcribe-src', platformId);
  fs.mkdirSync(outDir, { recursive: true });
  const localPath = path.join(outDir, `${sanitize(primary.title || 'media')}-${Date.now()}.${guessExt(primary.url)}`);
  await downloadOne(primary.url, localPath);
  return { localPath, downloaded: true, platform: platformId };
}

const transcribeSchema = {
  input: z.string().min(1).describe('A URL on any supported platform, or a local video/audio file path.'),
  platform: z.enum(PLATFORM_IDS).optional().describe('Override platform; omit to auto-detect.'),
  language: z.string().optional().describe('ISO 639-1 language hint for Whisper (e.g. "en", "zh", "ja").'),
  model: z.string().optional().describe('Whisper model: tiny | base | small | medium | large. Default: base.'),
  task: z.enum(['transcribe', 'translate']).optional().describe('"translate" → forces English output.'),
  format: z.enum(['text', 'srt', 'json']).optional().default('text').describe('Return format. Default: text.'),
  keep_audio: z.boolean().optional().default(false).describe('Keep the extracted .mp3 on disk.'),
};

server.tool(
  'transcribe_media',
  'Local transcript extraction. Downloads a URL (or accepts a local file path), extracts audio via ffmpeg, then runs a local Whisper CLI (no API key). Requires ffmpeg and one of: openai-whisper / whisper-ctranslate2.',
  transcribeSchema,
  async ({ input, platform, language, model, task, format = 'text', keep_audio = false }) => {
    let resolved;
    try {
      resolved = await resolveMediaForTranscript(input, platform);
    } catch (err) {
      return asError(`Resolve failed: ${err && err.message ? err.message : err}`);
    }

    let result;
    try {
      result = await transcribeFile(resolved.localPath, {
        language, model, task, keepAudio: keep_audio,
      });
    } catch (err) {
      return asError(`Whisper failed: ${err && err.message ? err.message : err}`);
    }

    let body;
    if (format === 'srt')        body = toSrt(result.segments);
    else if (format === 'json')  body = JSON.stringify(result, null, 2);
    else                          body = result.text;

    const lines = [
      `Source: ${input}`,
      resolved.platform ? `Platform: ${resolved.platform}` : null,
      `Local file: ${resolved.localPath}`,
      `Model: ${result.model}  ·  CLI: ${result.cli}`,
      result.language ? `Language: ${result.language}` : null,
      '',
      `── transcript (${format}) ──`,
      body,
    ].filter(Boolean).join('\n');

    return {
      content: [{ type: 'text', text: lines }],
      structuredContent: {
        source: input,
        platform: resolved.platform,
        local_path: resolved.localPath,
        format,
        body,
        text: result.text,
        segments: result.segments,
        language: result.language,
        model: result.model,
        cli: result.cli,
      },
    };
  }
);

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr only; stdout is the MCP transport.
  process.stderr.write(`btch-mcp ready · ${PLATFORMS.length} platforms · pid ${process.pid}\n`);
}

main().catch((err) => {
  process.stderr.write(`btch-mcp fatal: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});
