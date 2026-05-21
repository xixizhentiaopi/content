#!/usr/bin/env node
/**
 * btch — a small CLI wrapper around the `btch-downloader` npm package.
 *
 * Usage:
 *   btch <url|query>                 auto-detect platform, print JSON
 *   btch -p youtube <url>            force a platform
 *   btch <url> -d                    download discovered media into ./downloads
 *   btch <url> -o out/file.mp4       download the first media to a specific path
 *   btch list                        list supported platforms
 *
 *   --json      print pretty JSON of the raw API response (default)
 *   --urls      print only the discovered direct media URLs, one per line
 *   --first     when downloading, only fetch the first media
 *   --quiet     suppress progress lines (errors still go to stderr)
 */
'use strict';

const path = require('node:path');
const {
  PLATFORMS,
  detect,
  callPlatform,
  harvestMedia,
  dedupe,
  downloadOne,
  downloadMany,
} = require('./lib/btch.js');

function parseArgs(argv) {
  const args = { _: [], platform: null, download: false, out: null, urlsOnly: false, json: true, first: false, quiet: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '-h': case '--help': args.help = true; break;
      case '-p': case '--platform': args.platform = argv[++i]; break;
      case '-d': case '--download': args.download = true; break;
      case '-o': case '--out': args.out = argv[++i]; args.download = true; break;
      case '--urls': args.urlsOnly = true; args.json = false; break;
      case '--json': args.json = true; args.urlsOnly = false; break;
      case '--first': args.first = true; break;
      case '-q': case '--quiet': args.quiet = true; break;
      default:
        if (a.startsWith('-')) { console.error(`Unknown flag: ${a}`); process.exit(2); }
        args._.push(a);
    }
  }
  return args;
}

function help() {
  console.log([
    'btch — CLI for btch-downloader',
    '',
    'Usage:',
    '  btch <url|query> [options]',
    '  btch list                    list supported platforms',
    '',
    'Options:',
    '  -p, --platform <name>        force platform (default: auto-detect)',
    '  -d, --download               download discovered media into ./downloads',
    '  -o, --out <file>             download the first media to <file>',
    '      --first                  with -d, only download the first media',
    '      --urls                   print only direct media URLs (one per line)',
    '      --json                   print raw JSON response (default)',
    '  -q, --quiet                  suppress progress messages',
    '  -h, --help                   show this help',
    '',
    'Examples:',
    '  btch https://www.tiktok.com/@user/video/123',
    '  btch "Somewhere Only We Know" -p yts',
    '  btch https://youtu.be/C8mJ8943X80 -d',
    '  btch https://pin.it/4CVodSq -o ./pin.jpg',
  ].join('\n'));
}

(async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args._.length === 0) { help(); process.exit(args.help ? 0 : 1); }

  if (args._[0] === 'list') {
    console.log('Supported platforms:');
    for (const p of PLATFORMS) console.log(`  ${p.id.padEnd(12)} → btch.${p.fn}(${p.kind === 'query' ? 'query' : 'url'})`);
    process.exit(0);
  }

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
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(99);
});
