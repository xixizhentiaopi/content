#!/usr/bin/env node
/**
 * btch — a small CLI wrapper around the `btch-downloader` npm package,
 *        plus a local-only transcript extractor (ffmpeg + whisper).
 *
 * Subcommands:
 *   btch <url|query>                    auto-detect platform, print JSON (default)
 *   btch list                           list supported platforms
 *   btch transcribe <url|file> [opts]   download → ffmpeg → local whisper
 *
 *   --json      print pretty JSON of the raw API response (default)
 *   --urls      print only the discovered direct media URLs, one per line
 *   --first     when downloading, only fetch the first media
 *   --quiet     suppress progress lines (errors still go to stderr)
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  PLATFORMS,
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

function parseArgs(argv) {
  const args = {
    _: [],
    platform: null,
    download: false,
    out: null,
    urlsOnly: false,
    json: true,
    first: false,
    quiet: false,
    help: false,
    // transcribe-specific
    language: null,
    model: null,
    task: null,
    device: null,
    keepAudio: false,
    format: 'text',     // text | json | srt
    saveTranscript: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '-h': case '--help': args.help = true; break;
      case '-p': case '--platform': args.platform = argv[++i]; break;
      case '-d': case '--download': args.download = true; break;
      case '-o': case '--out': args.out = argv[++i]; args.download = true; break;
      case '--urls': args.urlsOnly = true; args.json = false; break;
      case '--json': args.json = true; args.urlsOnly = false; args.format = 'json'; break;
      case '--first': args.first = true; break;
      case '-q': case '--quiet': args.quiet = true; break;
      case '--lang': case '--language': args.language = argv[++i]; break;
      case '--model': args.model = argv[++i]; break;
      case '--task': args.task = argv[++i]; break;
      case '--device': args.device = argv[++i]; break;
      case '--keep-audio': args.keepAudio = true; break;
      case '--text': args.format = 'text'; break;
      case '--srt': args.format = 'srt'; break;
      case '-s': case '--save': args.saveTranscript = argv[++i]; break;
      default:
        if (a.startsWith('-')) { console.error(`Unknown flag: ${a}`); process.exit(2); }
        args._.push(a);
    }
  }
  return args;
}

function help() {
  console.log([
    'btch — CLI for btch-downloader + local Whisper transcription',
    '',
    'Usage:',
    '  btch <url|query> [options]              fetch/download media (default)',
    '  btch list                               list supported platforms',
    '  btch transcribe <url|file> [options]    transcribe via ffmpeg + local whisper',
    '',
    'Download options:',
    '  -p, --platform <name>     force platform (default: auto-detect)',
    '  -d, --download            download discovered media into ./downloads',
    '  -o, --out <file>          download the first media to <file>',
    '      --first               with -d, only download the first media',
    '      --urls                print only direct media URLs (one per line)',
    '      --json                print raw JSON response (default)',
    '  -q, --quiet               suppress progress messages',
    '',
    'Transcribe options:',
    '      --lang <iso>          language hint for whisper (e.g. en, zh, ja)',
    '      --model <name>        whisper model: tiny|base|small|medium|large (default: base)',
    '      --task <kind>         transcribe (default) or translate (→ English)',
    '      --device <dev>        cpu | cuda | mps',
    '      --keep-audio          keep the extracted .mp3 (default: removed)',
    '      --text                output plain text (default)',
    '      --json                output full whisper JSON (text + segments)',
    '      --srt                 output SubRip subtitles with timestamps',
    '  -s, --save <file>         also write transcript to <file>',
    '',
    'Environment:',
    '  BTCH_WHISPER_CMD       which CLI to invoke (default: tries `whisper`, then `whisper-ctranslate2`)',
    '  BTCH_WHISPER_MODEL     default model (overrides built-in `base`)',
    '',
    'Prerequisites for transcribe:',
    '  ffmpeg            (brew install ffmpeg / apt install ffmpeg)',
    '  whisper           (pip install -U openai-whisper)',
    '    OR whisper-ctranslate2 (pip install -U whisper-ctranslate2)',
    '',
    'Examples:',
    '  btch https://www.tiktok.com/@user/video/123',
    '  btch "Somewhere Only We Know" -p yts',
    '  btch transcribe https://www.tiktok.com/@user/video/123 --lang zh',
    '  btch transcribe ./local-video.mp4 --srt -s subtitles.srt',
    '  btch transcribe ./talk.mp3 --model small --json',
  ].join('\n'));
}

async function cmdDefault(args) {
  const input = args._.join(' ');
  const platform = args.platform || detect(input);
  const p = PLATFORMS.find((x) => x.id === platform);
  if (!p) { console.error(`Unknown platform: ${platform}. Run "btch list" to see supported ones.`); process.exit(2); }

  if (!args.quiet) console.error(`→ platform: ${p.id}  (${p.fn})`);

  let data;
  try {
    data = await callPlatform(p.id, input);
  } catch (err) {
    console.error(`✗ ${p.id} request failed: ${err && err.message ? err.message : err}`);
    process.exit(4);
  }

  const all = dedupe(harvestMedia(data, [], ''));

  if (args.urlsOnly) {
    for (const it of all) console.log(it.url);
  } else if (args.json) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  }

  if (args.download || args.out) {
    if (!all.length) { console.error('✗ no downloadable media URL found in the response.'); process.exit(5); }
    if (args.out) {
      if (!args.quiet) console.error(`  ↓ ${all[0].url.slice(0, 90)}`);
      try { await downloadOne(all[0].url, args.out); if (!args.quiet) console.error(`  ✓ saved ${args.out}`); }
      catch (err) { console.error(`  ✗ ${err.message}`); process.exit(6); }
    } else {
      const outDir = path.resolve('downloads', p.id);
      const saved = await downloadMany(all, outDir, { first: args.first });
      if (!args.quiet) for (const s of saved) console.error(s.ok ? `  ✓ ${s.path}` : `  ✗ ${s.error}`);
    }
  }
}

function isLocalFile(s) {
  try { return fs.existsSync(s) && fs.statSync(s).isFile(); }
  catch { return false; }
}

async function resolveMediaToFile(input, args) {
  if (isLocalFile(input)) return { localPath: input, downloaded: false };

  const platformId = args.platform || detect(input);
  const p = PLATFORMS.find((x) => x.id === platformId);
  if (!p) throw new Error(`Unknown platform: ${platformId}`);

  if (!args.quiet) console.error(`→ download · ${platformId}  (${p.fn})`);
  const data = await callPlatform(platformId, input);
  const media = dedupe(harvestMedia(data, [], ''));
  if (!media.length) throw new Error(`no downloadable media URL in the ${platformId} response`);

  const primary = media.find((m) => m.kind === 'video')
              || media.find((m) => m.kind === 'audio')
              || media.find((m) => m.kind !== 'image')
              || media[0];
  const outDir = path.join(os.tmpdir(), 'btch-transcribe-src', platformId);
  fs.mkdirSync(outDir, { recursive: true });
  const localPath = path.join(outDir, `${sanitize(primary.title || 'media')}-${Date.now()}.${guessExt(primary.url)}`);
  if (!args.quiet) console.error(`  ↓ ${primary.url.slice(0, 90)}`);
  await downloadOne(primary.url, localPath);
  if (!args.quiet) console.error(`  ✓ ${localPath}`);
  return { localPath, downloaded: true, platform: platformId };
}

async function cmdTranscribe(args) {
  const input = args._.slice(1).join(' ');
  if (!input) { console.error('transcribe: missing <url|file>'); process.exit(2); }

  let resolved;
  try {
    resolved = await resolveMediaToFile(input, args);
  } catch (err) {
    console.error(`✗ ${err.message}`); process.exit(4);
  }

  if (!args.quiet) console.error(`→ transcribe · ${path.basename(resolved.localPath)}`);

  let result;
  try {
    result = await transcribeFile(resolved.localPath, {
      language: args.language,
      model: args.model,
      task: args.task,
      device: args.device,
      keepAudio: args.keepAudio,
      onStderr: args.quiet ? null : (s) => process.stderr.write(s),
    });
  } catch (err) {
    console.error(`✗ ${err.message}`); process.exit(7);
  }

  let body;
  if (args.format === 'json') {
    body = JSON.stringify({
      source: input,
      platform: resolved.platform,
      local_path: resolved.localPath,
      ...result,
    }, null, 2);
  } else if (args.format === 'srt') {
    body = toSrt(result.segments);
  } else {
    body = result.text;
  }
  process.stdout.write(body + (body.endsWith('\n') ? '' : '\n'));

  if (args.saveTranscript) {
    fs.mkdirSync(path.dirname(path.resolve(args.saveTranscript)), { recursive: true });
    fs.writeFileSync(args.saveTranscript, body);
    if (!args.quiet) console.error(`  ✓ wrote ${args.saveTranscript}`);
  }
}

(async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args._.length === 0) { help(); process.exit(args.help ? 0 : 1); }

  if (args._[0] === 'list') {
    console.log('Supported platforms:');
    for (const p of PLATFORMS) console.log(`  ${p.id.padEnd(12)} → btch.${p.fn}(${p.kind === 'query' ? 'query' : 'url'})`);
    process.exit(0);
  }

  if (args._[0] === 'transcribe') return cmdTranscribe(args);

  return cmdDefault(args);
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(99);
});
