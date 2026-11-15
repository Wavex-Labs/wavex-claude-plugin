import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scrub, callTool, listSessionFiles, projectLabel } from './server.mjs';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'server.mjs');
const FAKE_KEY = 'sk_' + 'live_' + 'abcdefghijklmnop1234';
const FAKE_JWT = 'eyJ' + 'hbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstu';

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wavex-sessions-'));
  made.push(root);
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
  assert.equal(scrub('3 files changed, +120 -340'), '3 files changed, +120 -340');
});

test('scrub: E.164, international and unseparated phone numbers', () => {
  assert.equal(scrub('call me at +13055550142 today'), 'call me at [phone] today');
  for (const p of ['+44 20 7946 0958', '+34 612 345 678', '+52 55 1234 5678', '+1 (305) 555-0142', '3055550142', '13055550142']) {
    assert.equal(scrub(`call ${p}.`), 'call [phone].', p);
  }
  assert.equal(scrub('text me at +13055550142 or 3055550142'), 'text me at [phone] or [phone]');
  assert.equal(scrub('+44 20 7946 0958 1234 is the line'), '[phone] is the line');
});

test('scrub: PGP private key blocks and a private key with no END line', () => {
  const body = 'lQOYBF' + 'abcdefg';
  assert.equal(scrub(`a -----BEGIN PGP PRIVATE KEY BLOCK-----\n${body}\n-----END PGP PRIVATE KEY BLOCK----- b`), 'a [private key] b');
  assert.equal(scrub(`key:\n-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC`), 'key:\n[private key]');
  assert.equal(scrub(`-----BEGIN OPENSSH PRIVATE KEY-----\n${body}\n-----END OPENSSH PRIVATE KEY-----\nafter`), '[private key]\nafter');
});

// Fake secrets are built from pieces so this file never holds one whole.
const PW = 'hunter' + '2xyz';
const gone = (s, bads) => { for (const bad of bads) assert.ok(!s.includes(bad), `left: ${bad} in ${s}`); };

test('scrub: JSON-quoted secrets, plain, single-quoted and inside an escaped JSON string', () => {
  const s = scrub(`{"password": "${PW} 9"} "api_key": "abcd${PW}" {'token': 'qw${PW}'} {\\"passwd\\": \\"es${PW}\\", \\"user\\": \\"bob\\"} {"secret":"sh${PW}"}`);
  gone(s, [PW]);
  assert.match(s, /\{"password": "\[redacted\]"\}/);
  assert.match(s, /'token': '\[redacted\]'/);
  assert.match(s, /\\"user\\": \\"bob\\"/);
});

test('scrub: env-style names with 6 or more characters', () => {
  const s = scrub(`DB_PASS=db${PW} SECRET_KEY=sk${PW} PRIVATE_KEY=pk${PW} SMTP_PASSWORD=sm${PW} AUTH=au${PW} export DB_PASS="two ${PW}" ?pass=qs${PW}&auth=qa${PW}`);
  gone(s, [PW]);
  for (const name of ['DB_PASS', 'SECRET_KEY', 'PRIVATE_KEY', 'SMTP_PASSWORD', 'AUTH']) assert.ok(s.includes(`${name}=[redacted]`), name);
  assert.equal(scrub('AUTH=abc'), 'AUTH=abc');
});

test('scrub: passwords in connection URLs', () => {
  const s = scrub(`postgres://admin:${PW}@db.example.com:5432/app mongodb+srv://u:m${PW}@cluster0.example.net/x redis://:r${PW}@localhost:6379`);
  gone(s, [PW, 'admin:']);
  assert.ok(s.includes('postgres://[credentials]@db.example.com:5432/app'));
  assert.ok(s.includes('mongodb+srv://[credentials]@cluster0.example.net/x'));
  assert.ok(s.includes('redis://[credentials]@localhost:6379'));
});

test('scrub: sb_secret_, github_pat_, whsec_ and ya29. keys', () => {
  const keys = ['sb_' + 'secret_' + 'AbCdEf0123456789xyz', 'github_' + 'pat_' + '11ABCDEFG0123456789_abcdefghijklmnop', 'wh' + 'sec_' + 'AbCdEfGhIjKlMnOpQrStUv012345', 'ya' + '29.' + 'a0AfH6SMBxyzABCDEFGHIJKLMNOPQRstuv'];
  const s = scrub(keys.join(' and '));
  gone(s, keys);
  assert.equal(s, '[key] and [key] and [key] and [token]');
});

test('scrub keeps placeholders and prose about passwords', () => {
  const keep = 'Fill in the password field. password={password} "password": "{password}" postgres://{user}:{password}@{host}:5432/{db} token: {{token}} DB_PASS=${DB_PASS} api_key=<your api key> The author=Shakespeare. Second pass: rendered the video.';
  assert.equal(scrub(keep), keep);
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

test('list_sessions scrubs E.164 and unseparated phone numbers end to end', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wavex-sessions-'));
  made.push(root);
  fs.mkdirSync(path.join(root, '-Users-someone-calls'));
  const line = { type: 'user', cwd: '/Users/someone/calls', message: { role: 'user', content: 'text me at +13055550142 or 3055550142' } };
  fs.writeFileSync(path.join(root, '-Users-someone-calls', '22222222-3333-4444-5555-666666666666.jsonl'), JSON.stringify(line) + '\n');
  const r = await callTool('list_sessions', {}, root);
  assert.equal(r.sessions[0].first_ask, 'text me at [phone] or [phone]');
  assert.ok(!JSON.stringify(r).includes('5550142'));
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

// ── The home folder and the username never show (PL1) ──
// The made-up person is alex-smith. The name holds a dash on purpose: in Claude Code's dash form
// (-Users-alex-smith-work-app) nothing marks where the name ends.
const NAME = /alex|smith/i;
const POSIX_HOME = '/Users/alex-smith';
const WIN_HOME = 'C:\\Users\\alex-smith';

test('projectLabel: folder -Users-alex-smith-work-app with home /Users/alex-smith gives a label with no username', () => {
  const cases = [
    ['-Users-alex-smith-work-app', '', 'app'],
    ['-Users-alex-smith-work-app', '/Users/alex-smith/work/app', 'app'],
    ['-Users-alex-smith', '', 'home'],
    ['-Users-alex-smith', '/Users/alex-smith', 'home'],
    ['-Users-alex-smith', '/Users/alex-smith/', 'home'],
    ['-Users-alex-smith--claude', '/Users/alex-smith/.claude', '.claude'],
    // The home folder in dash form also sits inside the name of a temp folder made for that person.
    ['-private-tmp-claude-501--Users-alex-smith-s1-scratchpad', '', 'scratchpad'],
    ['-private-tmp-claude-501--Users-alex-smith', '', 'home'],
    // A folder named exactly like the username is not shown by name.
    ['-Users-alex-smith-code-alex-smith', '/Users/alex-smith/code/alex-smith', 'project'],
    ['-private-tmp-build', '', 'build'],
    ['-private-tmp-build', '/private/tmp/build', 'build'],
  ];
  for (const [dir, cwd, want] of cases) {
    const got = projectLabel(dir, cwd, POSIX_HOME);
    assert.equal(got, want, `${dir} | ${cwd}`);
    assert.doesNotMatch(got, NAME);
  }
});

test('projectLabel: a home folder outside /Users and /home, and a home folder that is not this person\'s', () => {
  assert.equal(projectLabel('-data-people-alex-smith-work-app', '', '/data/people/alex-smith'), 'app');
  assert.equal(projectLabel('-data-people-alex-smith', '/data/people/alex-smith', '/data/people/alex-smith'), 'home');
  // Someone else's home folder: where the name ends is unknown, so no part of it is used.
  for (const [dir, cwd, want] of [
    ['-Users-alex-smith', '', 'project'],
    ['-Users-alex-smith-work-app', '', 'project'],
    ['-Users-alex', '', 'home'],
    ['-home-alex-smith-work', '', 'project'],
    ['-private-tmp-claude-501--Users-alex-smith', '', 'project'],
    ['-Users-alex-smith', '/Users/alex-smith', 'home'],
    ['-home-alex-smith', '/home/alex-smith', 'home'],
    ['-Users-alex-smith-work-app', '/Users/alex-smith/work/app', 'app'],
  ]) {
    const got = projectLabel(dir, cwd, '/Users/someone');
    assert.equal(got, want, `${dir} | ${cwd}`);
    assert.doesNotMatch(got, NAME);
  }
  // A longer name that only starts like this person's is someone else.
  assert.equal(projectLabel('-Users-alexander-app', '', '/Users/alex'), 'project');
  // No usable home folder (/, /root): the old rule still holds and nothing breaks.
  assert.equal(projectLabel('-srv-app', '', '/'), 'app');
  assert.equal(projectLabel('-root-app', '/root/app', '/root'), 'app');
});

test('projectLabel: Windows-style folder C--Users-alex-smith-work-app with home C:\\Users\\alex-smith', () => {
  for (const [dir, cwd, want] of [
    ['C--Users-alex-smith-work-app', '', 'app'],
    ['c--Users-alex-smith-work-app', '', 'app'],
    ['C--Users-alex-smith-work-app', 'C:\\Users\\alex-smith\\work\\app', 'app'],
    ['C--Users-alex-smith', '', 'home'],
    ['C--Users-alex-smith', 'C:\\Users\\alex-smith', 'home'],
    ['C--Users-alex-smith', 'C:\\Users\\alex-smith\\', 'home'],
  ]) {
    const got = projectLabel(dir, cwd, WIN_HOME);
    assert.equal(got, want, `${dir} | ${cwd}`);
    assert.doesNotMatch(got, NAME);
  }
  // The same folders read on a computer with another home folder.
  assert.equal(projectLabel('C--Users-alex-smith-work-app', '', '/Users/someone'), 'project');
  assert.equal(projectLabel('C--Users-alex', '', '/Users/someone'), 'home');
  assert.equal(projectLabel('D--Users-alex-smith', 'D:\\Users\\alex-smith', '/Users/someone'), 'home');
});

test('scrub: a home folder in dash form is replaced, in a path, alone and inside a longer name', () => {
  assert.equal(scrub('see ~/.claude/projects/-Users-alex-smith-work-app/x.jsonl'), 'see ~/.claude/projects/~/x.jsonl');
  assert.equal(scrub('scratch is /private/tmp/claude-501/-Users-alex-smith/s1/scratchpad'), 'scratch is /private/tmp/claude-501/~/s1/scratchpad');
  assert.equal(scrub('cd "-Users-alex-smith-work-app" now'), 'cd "~" now');
  assert.equal(scrub('on linux: -home-alex-smith-work-app'), 'on linux: ~');
  assert.equal(scrub('on windows: C--Users-alex-smith-work-app and C:\\Users\\alex-smith\\work\\app'), 'on windows: ~ and ~\\work\\app');
  assert.doesNotMatch(scrub('folder -private-tmp-claude-501--Users-alex-smith-s1-scratchpad'), NAME);
});

test('scrub: this person\'s own home folder is replaced wherever it lives, and the project name after it stays', async () => {
  // The home folder comes from the process environment, so this runs scrub in a process of its own.
  const run = (home, text) => {
    const code = `import { scrub } from ${JSON.stringify(SERVER)}; process.stdout.write(scrub(${JSON.stringify(text)}));`;
    return new Promise((resolve) => { let out = ''; const c = spawn(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, HOME: home }, stdio: ['ignore', 'pipe', 'inherit'] }); c.stdout.on('data', (d) => { out += d; }); c.on('close', () => resolve(out)); });
  };
  assert.equal(await run(POSIX_HOME, 'log: ~/.claude/projects/-Users-alex-smith-work-app/x.jsonl, temp: -private-tmp-claude-501--Users-alex-smith-s1-scratchpad'),
    'log: ~/.claude/projects/~-work-app/x.jsonl, temp: -private-tmp-claude-501-~-s1-scratchpad');
  assert.equal(await run('/data/people/alex-smith', 'in /data/people/alex-smith/work/app and -data-people-alex-smith-work-app'), 'in ~/work/app and ~-work-app');
  assert.equal(await run(WIN_HOME, 'in C:\\Users\\alex-smith\\work and C--Users-alex-smith-work'), 'in ~\\work and ~-work');
  // A word that only holds the same letters stays; so does everything when the home folder names nobody (/root).
  assert.equal(await run('/home/user', 'per-home-user settings in /home/user/app'), 'per-home-user settings in ~/app');
  assert.equal(await run('/root', 'chown -root and /root/app'), 'chown -root and /root/app');
});

test('scrub: words that only look like a dash-form home folder stay', () => {
  const keep = 'useradd --home-dir /srv/app, the Power-Users-Guide, at-home-care notes, a home-made tool, Users-first design, 3 -Users were added';
  assert.equal(scrub(keep), keep);
});

// A sessions folder as it looks for alex-smith: a project, the home folder itself, a session with no folder recorded,
// a temp folder, and text that names the home folder in every form.
const HOME_IDS = ['aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000004'];
function makeHomeRoot(win = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wavex-sessions-'));
  made.push(root);
  const dash = win ? 'C--Users-alex-smith' : '-Users-alex-smith';
  const dir = (...parts) => (win ? [WIN_HOME, ...parts].join('\\') : [POSIX_HOME, ...parts].join('/'));
  const put = (folder, id, lines, mtime) => {
    fs.mkdirSync(path.join(root, folder), { recursive: true });
    const file = path.join(root, folder, `${id}.jsonl`);
    fs.writeFileSync(file, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
    fs.utimesSync(file, mtime, mtime);
    return file;
  };
  const now = Date.now() / 1000;
  put(`${dash}-work-app`, HOME_IDS[0], [
    { type: 'user', cwd: dir('work', 'app'), message: { role: 'user', content: `Tidy the notes in ${dir('work', 'app', 'notes.md')}. The log is ~/.claude/projects/${dash}-work-app/log.jsonl and scratch is /private/tmp/claude-501/${dash}/s1/scratchpad` } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: `Done. Wrote ${dir('work', 'app', 'out.md')} and read ${dash}-work-app.` }, { type: 'tool_use', name: 'Bash', input: {} }] } },
    { type: 'user', message: { role: 'user', content: `Now copy it to ${dir()} and to ${dash}-work-app` } },
    { type: 'custom-title', customTitle: `Notes for ${dash}-work-app` },
  ], now);
  put(dash, HOME_IDS[1], [{ type: 'user', cwd: dir(), message: { role: 'user', content: 'What is in my home folder?' } }], now - 10);
  put(`${dash}-side-job`, HOME_IDS[2], [{ type: 'user', message: { role: 'user', content: 'No folder is recorded in this one' } }], now - 20);
  const last = put(`-private-tmp-claude-501-${dash}-s1-scratchpad`, HOME_IDS[3], [{ type: 'user', message: { role: 'user', content: 'Scratch work' } }], now - 30);
  return { root, last };
}

// Calls tools on a real server process, so the home folder comes from that process's own environment.
async function callOverStdio(env, calls) {
  const child = spawn(process.execPath, [SERVER], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'inherit'] });
  let raw = '';
  child.stdout.on('data', (d) => { raw += d; });
  calls.forEach(([name, args], i) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i + 1, method: 'tools/call', params: { name, arguments: args } }) + '\n'));
  const got = () => (raw.endsWith('\n') ? raw.split('\n').filter(Boolean) : []);
  const deadline = Date.now() + 5000;
  while (got().length < calls.length && Date.now() < deadline) await new Promise(r => setTimeout(r, 25));
  child.kill();
  const byId = new Map(got().map(l => JSON.parse(l)).map(m => [m.id, m.result]));
  return { raw, results: calls.map((_, i) => byId.get(i + 1)) };
}
const ALL_CALLS = [['list_sessions', {}], ...HOME_IDS.map(id => ['get_session_digest', { session_id: id }])];

test('no output field of list_sessions or the digest holds the username (home /Users/alex-smith)', async () => {
  const { root } = makeHomeRoot();
  const { raw, results } = await callOverStdio({ HOME: POSIX_HOME, WAVEX_SESSIONS_ROOT: root }, ALL_CALLS);
  assert.equal(results.filter(Boolean).length, ALL_CALLS.length, raw);
  assert.doesNotMatch(raw, NAME);
  const list = results[0].structuredContent;
  assert.deepEqual(list.sessions.map(s => s.project), ['app', 'home', 'job', 'scratchpad']);
  assert.equal(list.sessions[0].title, 'Notes for ~-work-app');
  assert.match(list.sessions[0].first_ask, /~\/work\/app\/notes\.md.*projects\/~-work-app\/log\.jsonl.*claude-501\/~\/s1\/scratchpad/);
  const d = results[1].structuredContent;
  assert.equal(d.project, 'app');
  assert.equal(d.asks.length, 2);
  assert.match(d.results[0], /Wrote ~\/work\/app\/out\.md and read ~-work-app\./);
  for (const r of results) for (const field of Object.values(r.structuredContent).flatMap(v => (Array.isArray(v) ? v : [v]))) assert.doesNotMatch(JSON.stringify(field), NAME);
});

test('no output field holds the username on a Windows-style home (C:\\Users\\alex-smith)', async () => {
  const { root } = makeHomeRoot(true);
  const { raw, results } = await callOverStdio({ HOME: WIN_HOME, WAVEX_SESSIONS_ROOT: root }, ALL_CALLS);
  assert.equal(results.filter(Boolean).length, ALL_CALLS.length, raw);
  assert.doesNotMatch(raw, NAME);
  assert.deepEqual(results[0].structuredContent.sessions.map(s => s.project), ['app', 'home', 'job', 'scratchpad']);
  assert.equal(results[1].structuredContent.project, 'app');
});

test('no output field holds the username when the sessions belong to another home folder', async () => {
  // In this process the home folder is the test runner's own, so alex-smith is someone else.
  for (const win of [false, true]) {
    const { root } = makeHomeRoot(win);
    const list = await callTool('list_sessions', {}, root);
    assert.deepEqual(list.sessions.map(s => s.project), ['app', 'home', 'project', 'project']);
    assert.doesNotMatch(JSON.stringify(list), NAME);
    for (const id of HOME_IDS) assert.doesNotMatch(JSON.stringify(await callTool('get_session_digest', { session_id: id }, root)), NAME);
  }
});

test('an error message from a file that cannot be read holds no home folder', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
  const { root, last } = makeHomeRoot();
  fs.chmodSync(last, 0o000);
  const { raw, results } = await callOverStdio({ HOME: POSIX_HOME, WAVEX_SESSIONS_ROOT: root }, [['get_session_digest', { session_id: HOME_IDS[3] }]]);
  fs.chmodSync(last, 0o600);
  assert.equal(results[0].isError, true, raw);
  assert.match(results[0].structuredContent.message, /permission denied/);
  assert.doesNotMatch(raw, NAME);
});
