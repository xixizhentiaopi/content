#!/usr/bin/env node
/**
 * Quick smoke test: spawns mcp.mjs over stdio, runs the MCP handshake,
 * lists tools, and calls list_platforms. Prints results to stdout.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(here, '..', 'mcp.mjs');

const child = spawn(process.execPath, [serverPath], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

let buf = '';
const pending = new Map();
let id = 0;

function send(method, params) {
  id += 1;
  const msg = { jsonrpc: '2.0', id, method, params };
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify(msg) + '\n');
  });
}

function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

child.stdout.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(msg.error) : resolve(msg.result);
    }
  }
});

(async function run() {
  try {
    const init = await send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'smoke', version: '0' },
    });
    console.log('initialize OK →', JSON.stringify(init.serverInfo || init, null, 2));
    notify('notifications/initialized', {});

    const list = await send('tools/list', {});
    console.log('\ntools/list →');
    for (const t of list.tools || []) {
      console.log(`  · ${t.name}  —  ${t.description?.split('\n')[0]?.slice(0, 80) || ''}`);
    }

    const res = await send('tools/call', { name: 'list_platforms', arguments: {} });
    const text = res?.content?.[0]?.text || '(empty)';
    console.log('\nlist_platforms →\n' + text.split('\n').slice(0, 6).join('\n') + '\n  …');

    console.log('\n✓ smoke test passed.');
    child.kill();
    process.exit(0);
  } catch (err) {
    console.error('\n✗ smoke test failed:', err);
    child.kill();
    process.exit(1);
  }
})();
