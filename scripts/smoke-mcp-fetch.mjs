#!/usr/bin/env node
/** Calls fetch_media via MCP. Exits non-zero on protocol failure. */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const child = spawn(process.execPath, [path.resolve(here, '..', 'mcp.mjs')], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

let buf = '';
const pending = new Map();
let id = 0;
function send(method, params) {
  id += 1;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}
child.stdout.on('data', (c) => {
  buf += c.toString('utf8');
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(msg.error) : resolve(msg.result);
    }
  }
});

const query = process.argv[2] || 'Somewhere Only We Know';
const platform = process.argv[3] || 'yts';

(async () => {
  try {
    await send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } });
    notify('notifications/initialized', {});
    const res = await send('tools/call', {
      name: 'fetch_media',
      arguments: { input: query, platform, include_raw: false },
    });
    const text = res?.content?.[0]?.text || '';
    console.log(text.split('\n').slice(0, 12).join('\n'));
    console.log('---\nstructuredContent.media_count =', res?.structuredContent?.media_count);
    child.kill();
    process.exit(0);
  } catch (err) {
    console.error('✗', err);
    child.kill();
    process.exit(1);
  }
})();
