import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scrub, callTool, listSessionFiles } from './server.mjs';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'server.mjs');
const FAKE_KEY = 'sk_' + 'live_' + 'abcdefghijklmnop1234';
const FAKE_JWT = 'eyJ' + 'hbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstu';

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wavex-sessions-'));
  const proj = path.join(root, '-Users-someone-acme-video');
  fs.mkdirSync(proj);
  const lines = [
    { type: 'user', isMeta: true, cwd: '/Users/someone/acme-video', message: { role: 'user', content: '<system-reminder>internal rules</system-reminder>' } },
    { type: 'user', cwd: '/Users/someone/acme-video', message: { role: 'user', content: `Make a 30 second promo video for jane.doe@acme.com, call (305) 555-0142, key ${FAKE_KEY}` } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'I will plan the shots.' }, { type: 'tool_use', name: 'Bash', input: {} }, { type: 'tool_use', name: 'mcp__claude_ai_Higgsfield__generate', input: {} }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'secret output' }] } },
    { type: 'user', message: { role: 'user', content: `Use token ${FAKE_JWT} and save to /Users/someone/acme-video/out.mp4` } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Done: the 30 second promo is rendered, with captions and a music bed.' }] } },
    { type: 'custom-title', customTitle: 'Promo video for a client' },
    { type: 'pr-link', prNumber: 12 },
  ];
  const id = '11111111-2222-3333-4444-555555555555';
  fs.writeFileSync(path.join(proj, `${id}.jsonl`), lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  return { root, id };
}

test('scrub removes keys, tokens, emails, phones, local paths and reminders', () => {
  const s = scrub(`a ${FAKE_KEY} b ${FAKE_JWT} c jane@x.io d +1 305-555-0142 e /Users/omar/x <system-reminder>hidden</system-reminder> password=hunter2xyz`);
  for (const bad of [FAKE_KEY, FAKE_JWT, 'jane@x.io', '555-0142', '/Users/omar', 'hidden', 'hunter2xyz']) assert.ok(!s.includes(bad), `left: ${bad}`);
  assert.ok(s.includes('[key]') && s.includes('[token]') && s.includes('[email]') && s.includes('[phone]') && s.includes('~'));
});

test('scrub leaves plain numbers and dates alone', () => {
  assert.equal(scrub('version 1794763031 on 2026-11-15'), 'version 1794763031 on 2026-11-15');
});

test('list_sessions: newest first, title from the session, everything scrubbed, no tool results', async () => {
  const { root, id } = makeRoot();
  const files = listSessionFiles(root);
  assert.equal(files.length, 1);
  const r = await callTool('list_sessions', {}, root);
  assert.equal(r.count, 1);
  const s = r.sessions[0];
  assert.equal(s.id, id);
  assert.equal(s.title, 'Promo video for a client');
  assert.equal(s.project, 'acme-video');
  const all = JSON.stringify(r);
  for (const bad of ['jane.doe@acme.com', '555-0142', FAKE_KEY, FAKE_JWT, '/Users/someone', 'internal rules', 'secret output']) assert.ok(!all.includes(bad), `leaked: ${bad}`);
  assert.match(s.first_ask, /promo video/);
});

test('list_sessions query filters, limit is bounded', async () => {
  const { root } = makeRoot();
  assert.equal((await callTool('list_sessions', { query: 'promo' }, root)).count, 1);
  assert.equal((await callTool('list_sessions', { query: 'nothing like this' }, root)).count, 0);
  assert.equal((await callTool('list_sessions', { limit: 999 }, root)).count, 1);
});

test('get_session_digest: asks, results, tools, PR count; scrubbed; bounded', async () => {
  const { root, id } = makeRoot();
  const d = await callTool('get_session_digest', { session_id: id }, root);
  assert.equal(d.turns, 2);
  assert.equal(d.pull_requests, 1);
  assert.deepEqual(d.tools_used.map(t => t.name).sort(), ['Bash', 'mcp:generate']);
  assert.match(d.results.at(-1), /promo is rendered/);
  const all = JSON.stringify(d);
  for (const bad of ['jane.doe@acme.com', '555-0142', FAKE_KEY, FAKE_JWT, '/Users/someone', 'secret output', 'internal rules']) assert.ok(!all.includes(bad), `leaked: ${bad}`);
  assert.ok(all.length <= 24 * 1024);
});

test('get_session_digest refuses a malformed id and reports an unknown one', async () => {
  const { root } = makeRoot();
  await assert.rejects(callTool('get_session_digest', { session_id: '../../etc/passwd' }, root), e => e.code === 'bad_input');
  await assert.rejects(callTool('get_session_digest', { session_id: '99999999-0000-0000-0000-000000000000' }, root), e => e.code === 'not_found');
});

test('stdio: initialize, tools/list with read-only tools, tools/call', async () => {
  const { root, id } = makeRoot();
  const child = spawn(process.execPath, [SERVER], { env: { ...process.env, WAVEX_SESSIONS_ROOT: root }, stdio: ['pipe', 'pipe', 'inherit'] });
  const replies = new Map();
  let buf = '';
  child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); const m = JSON.parse(l); replies.set(m.id, m); } });
  const ask = (id, method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  ask(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  ask(2, 'tools/list', {});
  ask(3, 'tools/call', { name: 'get_session_digest', arguments: { session_id: id } });
  ask(4, 'tools/call', { name: 'get_session_digest', arguments: { session_id: 'nope' } });
  const deadline = Date.now() + 5000;
  while (replies.size < 4 && Date.now() < deadline) await new Promise(r => setTimeout(r, 25));
  child.kill();
  assert.equal(replies.get(1).result.serverInfo.name, 'wavex-sessions');
  const tools = replies.get(2).result.tools;
  assert.deepEqual(tools.map(t => t.name), ['list_sessions', 'get_session_digest']);
  assert.ok(tools.every(t => t.annotations.readOnlyHint === true));
  assert.equal(replies.get(3).result.structuredContent.id, id);
  assert.equal(replies.get(4).result.isError, true);
  assert.equal(replies.get(4).result.structuredContent.reason, 'bad_input');
});
