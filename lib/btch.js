'use strict';
/**
 * Shared internals for the CLI and the MCP server.
 *
 * Exports:
 *   PLATFORMS          — registry of supported sites + per-site regex + library fn name
 *   detect(input)      — pick a platform id from a URL or fall back to "yts"
 *   harvestMedia(...)  — walk a response object and collect direct media URLs
 *   dedupe(items)      — drop duplicate-by-url items, preserving order
 *   loadLibrary()      — lazy require of btch-downloader (so failures stay graceful)
 *   downloadOne(...)   — stream-download a single URL to a file path
 *   sanitize(name)     — make a filename safe for the OS
 *   guessExt(url)      — pull a sane extension off a URL
 */
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');

const PLATFORMS = [
  { id: 'instagram',   fn: 'igdl',       kind: 'url',   regex: /instagram\.com\/(p|reel|tv)\//i },
  { id: 'tiktok',      fn: 'ttdl',       kind: 'url',   regex: /(tiktok\.com\/@[\w.-]+\/video\/\d+|vm\.tiktok\.com|vt\.tiktok\.com)/i },
  { id: 'facebook',    fn: 'fbdown',     kind: 'url',   regex: /(facebook\.com\/(?:watch\/?\?v=|reel\/|share\/?|sharer\.php\?u=|photo\.php\?fbid=|video\.php\?v=|\w+\/(?:videos|posts)\/)|fb\.watch\/)/i },
  { id: 'twitter',     fn: 'twitter',    kind: 'url',   regex: /(twitter\.com|x\.com)\/\w+\/status\/\d+/i },
  { id: 'youtube',     fn: 'youtube',    kind: 'url',   regex: /(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/)[\w-]+/i },
  { id: 'mediafire',   fn: 'mediafire',  kind: 'url',   regex: /mediafire\.com\/(file|download|view)\//i },
  { id: 'capcut',      fn: 'capcut',     kind: 'url',   regex: /capcut\.com\/(template-detail\/\d+|@[\w.-]+\/video\/[\w-]+|t\/[\w-]+|\d+)/i },
  { id: 'gdrive',      fn: 'gdrive',     kind: 'url',   regex: /drive\.google\.com\/(file\/d\/|open\?id=)[\w-]+/i },
  { id: 'pinterest',   fn: 'pinterest',  kind: 'any',   regex: /(pinterest\.com\/pin\/\d+|pin\.it\/[\w]+)/i },
  { id: 'douyin',      fn: 'douyin',     kind: 'url',   regex: /(v\.douyin\.com\/\w+|douyin\.com\/\S+)/i },
  { id: 'xiaohongshu', fn: 'xiaohongshu',kind: 'url',   regex: /(xiaohongshu\.com\/discovery\/item\/\d+|xhslink\.com\/[\w]+)/i },
  { id: 'snackvideo',  fn: 'snackvideo', kind: 'url',   regex: /snackvideo\.com\/@[\w.-]+\/video\/\d+|s\.snackvideo\.com\/\w+/i },
  { id: 'cocofun',     fn: 'cocofun',    kind: 'url',   regex: /(icocofun|cocofun)\.com\/(share\/)?post\/\d+/i },
  { id: 'spotify',     fn: 'spotify',    kind: 'url',   regex: /(open\.spotify\.com\/(track|album|playlist|episode)\/\w+|spotify\.link\/\w+)/i },
  { id: 'soundcloud',  fn: 'soundcloud', kind: 'url',   regex: /soundcloud\.com\/[\w.-]+\/[\w.-]+/i },
  { id: 'threads',     fn: 'threads',    kind: 'url',   regex: /threads\.net\/@[\w.-]+\/post\/[\w_-]+/i },
  { id: 'kuaishou',    fn: 'kuaishou',   kind: 'url',   regex: /(v\.kuaishou\.com\/\w+|kuaishou\.com\/(?:short-video|video|share)\/\w+)/i },
  { id: 'yts',         fn: 'yts',        kind: 'query', regex: null },
  { id: 'aio',         fn: 'aio',        kind: 'url',   regex: null },
];
const PLATFORM_IDS = PLATFORMS.map((p) => p.id);

const MEDIA_KEYS = [
  'video', 'videoUrl', 'video_url', 'mp4', 'videoHd', 'video_hd', 'hd', 'sd',
  'no_watermark', 'nowatermark', 'nowm', 'play', 'playAddr', 'play_addr',
  'audio', 'audioUrl', 'audio_url', 'music', 'mp3',
  'image', 'imageUrl', 'image_url', 'photo', 'thumbnail', 'thumb', 'cover',
  'url', 'downloadUrl', 'download', 'link',
];
const TITLE_KEYS = ['title', 'desc', 'description', 'caption', 'name', 'filename'];

function isHttpUrl(s) {
  try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
}

// Proxies like dl.snapcdn.app hide the real upstream URL inside a JWT.
// Decode the payload (no signature check — we only need filename / mime).
function peekJwtPayload(url) {
  const m = String(url).match(/[?&]token=([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    const std = m[1].split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(std, 'base64').toString('utf8'));
  } catch { return null; }
}

function detect(value) {
  if (isHttpUrl(value)) {
    for (const p of PLATFORMS) if (p.regex && p.regex.test(value)) return p.id;
    return 'pinterest';
  }
  return 'yts';
}

function pickFirst(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) if (obj[k] != null && obj[k] !== '') return obj[k];
  return undefined;
}
function looksLikeMediaUrl(s) { return typeof s === 'string' && /^https?:\/\//i.test(s); }
function guessKind(url, hint) {
  if (hint && /audio|mp3|music/i.test(hint)) return 'audio';
  if (hint && /image|photo|thumb|cover/i.test(hint)) return 'image';
  if (hint && /video|mp4|play|hd|sd|nowm|no_watermark/i.test(hint)) return 'video';
  if (/\.(mp4|mov|webm|m4v)(\?|$)/i.test(url)) return 'video';
  if (/\.(mp3|m4a|aac|ogg|wav|flac)(\?|$)/i.test(url)) return 'audio';
  if (/\.(jpe?g|png|gif|webp|bmp|avif)(\?|$)/i.test(url)) return 'image';
  // Last resort: peek at a JWT-tunnelled token (snapcdn etc.).
  const j = peekJwtPayload(url);
  if (j) {
    const probe = `${j.url || ''} ${j.filename || ''} ${j.mime || ''} ${j.mime_type || ''}`;
    if (/video[_/-]?mp4|\.mp4\b|\.mov\b|\.webm\b|\.m4v\b/i.test(probe)) return 'video';
    if (/audio|\.mp3\b|\.m4a\b|\.aac\b|\.wav\b|\.flac\b|\.ogg\b/i.test(probe)) return 'audio';
    if (/image|\.jpe?g\b|\.png\b|\.webp\b|\.gif\b/i.test(probe)) return 'image';
  }
  return 'file';
}

function harvestMedia(node, acc, pathStr) {
  if (acc == null) acc = [];
  if (pathStr == null) pathStr = '';
  if (node == null) return acc;
  if (Array.isArray(node)) {
    node.forEach((v, i) => harvestMedia(v, acc, `${pathStr}[${i}]`));
    return acc;
  }
  if (typeof node === 'object') {
    const url = pickFirst(node, MEDIA_KEYS);
    if (looksLikeMediaUrl(url)) {
      const title = pickFirst(node, TITLE_KEYS) || pathStr || 'item';
      acc.push({ url, title: String(title), kind: guessKind(url) });
    }
    for (const [k, v] of Object.entries(node)) {
      if (looksLikeMediaUrl(v) && MEDIA_KEYS.includes(k)) {
        acc.push({ url: v, title: k, kind: guessKind(v, k) });
      } else if (typeof v === 'object') {
        harvestMedia(v, acc, pathStr ? `${pathStr}.${k}` : k);
      }
    }
  }
  return acc;
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((it) => (seen.has(it.url) ? false : (seen.add(it.url), true)));
}

function sanitize(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|\n\r\t]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80) || 'media';
}

function guessExt(url) {
  const m = String(url).split('?')[0].match(/\.([a-z0-9]{2,5})$/i);
  if (m) return m[1].toLowerCase();
  const j = peekJwtPayload(url);
  if (j && j.filename) {
    const fn = String(j.filename).match(/\.([a-z0-9]{2,5})$/i);
    if (fn) return fn[1].toLowerCase();
  }
  return 'bin';
}

let _btchCache = null;
function loadLibrary() {
  if (_btchCache) return _btchCache;
  try {
    _btchCache = require('btch-downloader');
    return _btchCache;
  } catch (err) {
    throw new Error(
      'btch-downloader is not installed in this project. Run `npm install` first.'
    );
  }
}

async function callPlatform(platformId, input) {
  const p = PLATFORMS.find((x) => x.id === platformId);
  if (!p) throw new Error(`Unknown platform: ${platformId}`);
  const lib = loadLibrary();
  const fn = lib[p.fn];
  if (typeof fn !== 'function') {
    throw new Error(`btch-downloader is missing function "${p.fn}". Try upgrading.`);
  }
  return await fn(input);
}

async function downloadOne(url, destPath) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  await pipeline(res.body, fs.createWriteStream(destPath));
  return destPath;
}

async function downloadMany(items, outDir, { first = false } = {}) {
  const targets = first ? items.slice(0, 1) : items;
  const saved = [];
  for (let i = 0; i < targets.length; i++) {
    const it = targets[i];
    const base = sanitize(it.title || `item_${i + 1}`);
    const ext = guessExt(it.url);
    const dest = path.join(outDir, `${String(i + 1).padStart(2, '0')}_${base}.${ext}`);
    try {
      await downloadOne(it.url, dest);
      saved.push({ ok: true, path: dest, url: it.url, kind: it.kind });
    } catch (err) {
      saved.push({ ok: false, error: err.message, url: it.url, kind: it.kind });
    }
  }
  return saved;
}

module.exports = {
  PLATFORMS,
  PLATFORM_IDS,
  detect,
  isHttpUrl,
  harvestMedia,
  dedupe,
  sanitize,
  guessExt,
  loadLibrary,
  callPlatform,
  downloadOne,
  downloadMany,
};
