'use strict';
/**
 * Local-only transcript extraction. No API keys, no network calls (beyond
 * whatever the user's whisper install does on first model download).
 *
 * Pipeline: ffmpeg → mp3 (16kHz mono) → local whisper CLI → { text, segments, language }
 *
 * Detects the first available CLI from:
 *   - $BTCH_WHISPER_CMD                (explicit override)
 *   - `whisper`                        (openai-whisper, pip)
 *   - `whisper-ctranslate2`            (faster-whisper CLI)
 *
 * Install one:
 *   pip install -U openai-whisper
 *   pip install -U whisper-ctranslate2
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

function runCommand(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => { stdout += d.toString(); });
    p.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      if (opts.onStderr) opts.onStderr(s);
    });
    p.on('error', reject);
    p.on('exit', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-400) || stdout.slice(-400)}`));
    });
  });
}

function probe(cmd) {
  return new Promise((resolve) => {
    const p = spawn(cmd, ['--help'], { stdio: 'ignore' });
    p.on('error', () => resolve(false));
    p.on('exit', () => resolve(true));
  });
}

async function hasFfmpeg() { return probe('ffmpeg'); }

async function findWhisperCmd() {
  const cands = [process.env.BTCH_WHISPER_CMD, 'whisper', 'whisper-ctranslate2'].filter(Boolean);
  for (const c of cands) if (await probe(c)) return c;
  return null;
}

async function extractAudio(videoPath, audioPath, opts = {}) {
  if (!(await hasFfmpeg())) {
    throw new Error(
      'ffmpeg not found on PATH. Install: macOS `brew install ffmpeg`, Ubuntu `apt install ffmpeg`.'
    );
  }
  fs.mkdirSync(path.dirname(audioPath), { recursive: true });
  await runCommand('ffmpeg', [
    '-y', '-i', videoPath,
    '-vn',
    '-acodec', 'libmp3lame',
    '-ar', '16000',
    '-ac', '1',
    '-b:a', '64k',
    audioPath,
  ], opts);
  return audioPath;
}

async function whisperRun(audioPath, opts = {}) {
  const cmd = opts.whisperCmd || (await findWhisperCmd());
  if (!cmd) {
    throw new Error(
      'No local Whisper CLI found on PATH. Install one of:\n' +
      '  pip install -U openai-whisper\n' +
      '  pip install -U whisper-ctranslate2\n' +
      'Or set BTCH_WHISPER_CMD to any whisper-compatible CLI.'
    );
  }

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'btch-whisper-'));
  const model = opts.model || process.env.BTCH_WHISPER_MODEL || 'base';

  const args = [
    audioPath,
    '--output_format', 'json',
    '--output_dir', outDir,
    '--model', model,
  ];
  if (opts.language)        args.push('--language', opts.language);
  if (opts.task)            args.push('--task', opts.task);   // transcribe | translate
  if (opts.device)          args.push('--device', opts.device);
  if (opts.initial_prompt)  args.push('--initial_prompt', opts.initial_prompt);

  await runCommand(cmd, args, opts);

  const base = path.basename(audioPath, path.extname(audioPath));
  const jsonPath = path.join(outDir, `${base}.json`);
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`Whisper did not produce ${jsonPath} — unexpected CLI output.`);
  }
  const out = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  try { fs.rmSync(outDir, { recursive: true, force: true }); } catch { /* ignore */ }

  return {
    text: (out.text || '').trim(),
    segments: out.segments || [],
    language: out.language,
    model,
    cli: cmd,
  };
}

async function transcribeFile(videoOrAudioPath, opts = {}) {
  if (!fs.existsSync(videoOrAudioPath)) {
    throw new Error(`File not found: ${videoOrAudioPath}`);
  }
  const ext = path.extname(videoOrAudioPath).toLowerCase();
  const alreadyAudio = ['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.aac'].includes(ext);

  let audioPath = videoOrAudioPath;
  let cleanup = false;
  if (!alreadyAudio) {
    const tmpDir = opts.tmpDir || path.join(os.tmpdir(), 'btch-transcribe');
    const base = path.basename(videoOrAudioPath, ext);
    audioPath = opts.audioOut || path.join(tmpDir, `${base}-${Date.now()}.mp3`);
    await extractAudio(videoOrAudioPath, audioPath, opts);
    cleanup = !opts.keepAudio && !opts.audioOut;
  }

  try {
    return await whisperRun(audioPath, opts);
  } finally {
    if (cleanup) { try { fs.unlinkSync(audioPath); } catch { /* ignore */ } }
  }
}

function toSrt(segments) {
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const fmt = (s) => {
    const ms = Math.round((s - Math.floor(s)) * 1000);
    const total = Math.floor(s);
    const h = (total / 3600) | 0;
    const m = ((total % 3600) / 60) | 0;
    const sec = total % 60;
    return `${pad(h)}:${pad(m)}:${pad(sec)},${pad(ms, 3)}`;
  };
  return segments.map((seg, i) =>
    `${i + 1}\n${fmt(seg.start || 0)} --> ${fmt(seg.end || seg.start || 0)}\n${(seg.text || '').trim()}\n`
  ).join('\n');
}

module.exports = {
  hasFfmpeg,
  findWhisperCmd,
  extractAudio,
  whisperRun,
  transcribeFile,
  toSrt,
};
