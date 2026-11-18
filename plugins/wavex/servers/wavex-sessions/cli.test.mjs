// PL2: the command-line mode (--cli), the setup mark (kind), the bounded scrub, and whose sessions are read.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scrub, callTool, cli, sessionsRoot } from './server.mjs';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'server.mjs');
const FAKE_KEY = 'sk_' + 'live_' + 'abcdefghijklmnop1234';

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (name) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), name)); made.push(d); return d; };

const user = (content, more = {}) => ({ type: 'user', message: { role: 'user', content }, ...more });
const says = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
// What Claude Code writes when the person types a slash command.
const typedCommand = (name, args = '') => user(`<command-message>${name.slice(1)}</command-message>\n<command-name>${name}</command-name>\n<command-args>${args}</command-args>`);
let clock = Date.now() / 1000;
function put(root, project, id, lines) {
  fs.mkdirSync(path.join(root, project), { recursive: true });
  const file = path.join(root, project, `${id}.jsonl`);
  fs.writeFileSync(file, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  clock -= 10; // each one older than the last, so the list order is the order they were made in
  fs.utimesSync(file, clock, clock);
  return file;
}
const ID = (n) => `${String(n).repeat(8)}-0000-4000-8000-000000000000`;
const IDS = { work: ID(1), shopText: ID(2), shopCommand: ID(3), plugin: ID(4), namespaced: ID(5), mention: ID(6), lookalike: ID(7), reminder: ID(8) };

function makeRoot() {
  const root = tmp('wavex-cli-');
  put(root, '-Users-someone-acme-video', IDS.work, [
    user(`Make a promo video for jane.doe@acme.com, call (305) 555-0142, key ${FAKE_KEY}`, { cwd: '/Users/someone/acme-video' }),
    says('Done: the promo is rendered.'),
    { type: 'custom-title', customTitle: 'Promo video for a client' },
  ]);
  put(root, '-Users-someone', IDS.shopText, [user('/wavex-shop ABC123'), says('Your WaveX page is ready.'), user('thanks')]);
  put(root, '-Users-someone', IDS.shopCommand, [
    typedCommand('/wavex-shop', 'ABC123'),
    user('# /wavex-shop\nMake the page.', { isMeta: true }),
    says('Your WaveX page is ready.'),
    user('Now list my invoices'),
  ]);
  put(root, '-Users-someone', IDS.plugin, [
    typedCommand('/plugin', 'marketplace add wavex'),
    user('<local-command-stdout>Added the marketplace</local-command-stdout>'),
    typedCommand('/wavex-shop', 'ABC123'),
    says('Your WaveX page is ready.'),
  ]);
  put(root, '-Users-someone', IDS.namespaced, [typedCommand('/wavex:wavex-post', '--save'), says('Saved.')]);
  put(root, '-Users-someone', IDS.mention, [user('Explain what /wavex-shop ABC123 and /plugin do'), says('They set WaveX up.')]);
  put(root, '-Users-someone', IDS.lookalike, [typedCommand('/plugin-authoring', 'a panel'), says('Here is the panel.')]);
  put(root, '-Users-someone', IDS.reminder, [user('<system-reminder>rules</system-reminder>\n/wavex-post'), says('Posted.')]);
  return root;
}

// Runs the reader as its own process and collects what it prints.
function run(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SERVER, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => resolve({ code, out, err }));
  });
}
const withRoot = (root) => ({ ...process.env, WAVEX_SESSIONS_ROOT: root });
// One JSON line: no line break inside it, one at the end.
const oneLine = (out) => { assert.match(out, /^[^\n]+\n$/, 'one JSON line'); return JSON.parse(out); };

// The same calls on the stdio server, for the tool's own answer.
async function overStdio(env, calls) {
  const child = spawn(process.execPath, [SERVER], { env, stdio: ['pipe', 'pipe', 'inherit'] });
  let raw = '';
  child.stdout.on('data', (d) => { raw += d; });
  calls.forEach(([name, args], i) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i + 1, method: 'tools/call', params: { name, arguments: args } }) + '\n'));
  const got = () => (raw.endsWith('\n') ? raw.split('\n').filter(Boolean) : []);
  const deadline = Date.now() + 5000;
  while (got().length < calls.length && Date.now() < deadline) await new Promise(r => setTimeout(r, 25));
  child.kill();
  const byId = new Map(got().map(l => JSON.parse(l)).map(m => [m.id, m.result]));
  return calls.map((_, i) => byId.get(i + 1));
}

test('--cli list_sessions and get_session_digest print one JSON line equal to the tool\'s output on the same folder', async () => {
  const root = makeRoot(), env = withRoot(root);
  const [toolList, toolDigest, toolQuery] = await overStdio(env, [
    ['list_sessions', { limit: 50 }], ['get_session_digest', { session_id: IDS.work }], ['list_sessions', { limit: 2, query: 'promo' }],
  ]);
  const list = await run(['--cli', 'list_sessions', '--limit', '50'], env);
  assert.equal(list.code, 0, list.err);
  assert.equal(list.err, '');
  assert.deepEqual(oneLine(list.out), toolList.structuredContent);
  assert.equal(list.out, toolList.content[0].text + '\n');
  assert.equal(list.out, JSON.stringify(await callTool('list_sessions', { limit: 50 }, root)) + '\n');
  assert.equal(oneLine(list.out).count, Object.keys(IDS).length);

  const digest = await run(['--cli', 'get_session_digest', '--id', IDS.work], env);
  assert.equal(digest.code, 0, digest.err);
  assert.deepEqual(oneLine(digest.out), toolDigest.structuredContent);
  assert.equal(digest.out, toolDigest.content[0].text + '\n');

  const query = await run(['--cli', 'list_sessions', '--limit', '2', '--query', 'promo'], env);
  assert.deepEqual(oneLine(query.out), toolQuery.structuredContent);
  assert.deepEqual(oneLine(query.out).sessions.map(s => s.id), [IDS.work]);
});

test('--cli uses the same scrub: no key, email, phone or home folder in its output', async () => {
  const root = makeRoot(), env = withRoot(root);
  const outs = [await run(['--cli', 'list_sessions'], env), await run(['--cli', 'get_session_digest', '--id', IDS.work], env)];
  for (const { out } of outs) {
    for (const bad of [FAKE_KEY, 'jane.doe@acme.com', '555-0142', '/Users/someone']) assert.ok(!out.includes(bad), `left: ${bad}`);
  }
  assert.match(outs[0].out, /\[email\].*\[phone\].*\[key\]/);
});

test('--cli: an unknown id exits 2 with a JSON error, and so does every other refused call', async () => {
  const env = withRoot(makeRoot());
  const unknown = await run(['--cli', 'get_session_digest', '--id', '99999999-0000-0000-0000-000000000000'], env);
  assert.equal(unknown.code, 2);
  assert.equal(oneLine(unknown.out).error.code, 'not_found');
  assert.match(oneLine(unknown.out).error.message, /No session with that id on this computer\. Call list_sessions again\./);
  for (const [args, code, says] of [
    [['get_session_digest', '--id', '../../etc/passwd'], 'bad_input', /^--id must be an id from list_sessions/],
    [['get_session_digest'], 'bad_input', /^--id is missing\. Add --id/],
    [['get_session_digest', '--id'], 'bad_input', /^--id has no value/],
    [['list_sessions', '--limit', 'many'], 'bad_input', /^--limit must be a number from 1 to 50/],
    [['list_sessions', '--all', 'yes'], 'bad_input', /^--all is not an option\. Use --limit or --query/],
    [['delete_sessions'], 'unsupported_op', /must be list_sessions or get_session_digest/],
    [[], 'unsupported_op', /must be list_sessions or get_session_digest/],
  ]) {
    const r = await run(['--cli', ...args], env);
    assert.equal(r.code, 2, args.join(' '));
    const { error } = oneLine(r.out);
    assert.equal(error.code, code, args.join(' '));
    assert.match(error.message, says);
  }
  // The same answers without a process, for callers inside Node.
  assert.equal((await cli(['get_session_digest', '--id', '99999999-0000-0000-0000-000000000000'], makeRoot())).code, 2);
});

test('kind: a session that begins with /wavex-shop ABC123 is "setup", as typed text and as a stored slash command', async () => {
  const root = makeRoot();
  const { sessions } = await callTool('list_sessions', { limit: 50 }, root);
  const kind = Object.fromEntries(sessions.map(s => [s.id, s.kind]));
  assert.equal(kind[IDS.shopText], 'setup');
  assert.equal(kind[IDS.shopCommand], 'setup');
  assert.equal(kind[IDS.plugin], 'setup', '/plugin marketplace add');
  assert.equal(kind[IDS.namespaced], 'setup', '/wavex:wavex-post');
  assert.equal(kind[IDS.reminder], 'setup', 'a reminder block before the command');
  assert.equal(kind[IDS.work], 'work');
  assert.equal(kind[IDS.mention], 'work', 'a session that only talks about /wavex-shop');
  assert.equal(kind[IDS.lookalike], 'work', '/plugin-authoring is not /plugin');
  // The digest and the command line say the same.
  for (const [name, id] of Object.entries(IDS)) assert.equal((await callTool('get_session_digest', { session_id: id }, root)).kind, kind[id], name);
  const out = oneLine((await run(['--cli', 'list_sessions', '--limit', '50'], withRoot(root))).out);
  assert.deepEqual(Object.fromEntries(out.sessions.map(s => [s.id, s.kind])), kind);
  // The first ask shown is still the first thing asked in words.
  assert.equal(sessions.find(s => s.id === IDS.shopCommand).first_ask, 'Now list my invoices');
});

// ── Whose sessions are read ──
test('with WAVEX_SESSIONS_ROOT unset the root is under the caller\'s own home only', () => {
  const home = path.join(path.sep, 'Users', 'alex-smith');
  const own = path.join(home, '.claude', 'projects');
  assert.equal(sessionsRoot({}, home), own);
  assert.equal(sessionsRoot({ CLAUDE_CONFIG_DIR: path.join(home, '.config', 'claude') }, home), path.join(home, '.config', 'claude', 'projects'));
  for (const outside of [
    path.join(path.sep, 'Users', 'someone-else', '.claude'), // another person's folder
    path.join(path.sep, 'Users', 'alex-smith2', '.claude'), // a name that only starts the same
    path.join(path.sep, 'Users', 'Shared', 'claude'),
    path.join(home, '..', 'someone-else', '.claude'), // out through ..
    path.sep,
  ]) {
    assert.equal(sessionsRoot({ CLAUDE_CONFIG_DIR: outside }, home), own, outside);
  }
  // Naming a folder outright still works; the tests rely on it.
  assert.equal(sessionsRoot({ WAVEX_SESSIONS_ROOT: path.join(path.sep, 'tmp', 'fixture') }, home), path.join(path.sep, 'tmp', 'fixture'));
});

test('--cli with WAVEX_SESSIONS_ROOT unset lists the caller\'s own home, not the folder CLAUDE_CONFIG_DIR points at', async () => {
  const home = tmp('wavex-home-'), elsewhere = tmp('wavex-elsewhere-');
  put(path.join(home, '.claude', 'projects'), '-work-mine', ID(1), [user('My own session')]);
  put(path.join(elsewhere, 'projects'), '-work-theirs', ID(2), [user('Someone else\'s session')]);
  const env = { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: elsewhere };
  delete env.WAVEX_SESSIONS_ROOT;
  const r = await run(['--cli', 'list_sessions', '--limit', '50'], env);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(oneLine(r.out).sessions.map(s => s.id), [ID(1)]);
  const other = await run(['--cli', 'get_session_digest', '--id', ID(2)], env);
  assert.equal(other.code, 2);
  assert.equal(oneLine(other.out).error.code, 'not_found');
});

test('the reader opens no network: it imports only files, paths, the system, line reading and URLs', () => {
  const src = fs.readFileSync(SERVER, 'utf8');
  const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map(m => m[1]).sort();
  assert.deepEqual(imports, ['node:fs', 'node:os', 'node:path', 'node:readline', 'node:url']);
  assert.doesNotMatch(src, /\bimport\s*\(|\brequire\s*\(|\bfetch\s*\(|WebSocket|node:(?:net|http|https|http2|dgram|tls|dns|child_process|worker_threads)/);
});

// ── The bounded scrub (the same change as the server's, MVP S0) ──
const ms = (f) => { const t = performance.now(); f(); return performance.now() - t; };

test('scrub time grows with the length: hostile input at 20,000 and 40,000 repeats, each under 250 ms, time ratio at most 2.6', () => {
  scrub('warm up a.b@c.de a://:x@y 3055550142 "password": "abcdefg" DB_PASS=abcdefg <command-a>x</command-a> \n');
  const shapes = [
    // The six of the plan, then the runs each rule of this helper can be made to scan again and again.
    ...['"a', 'a_', 'A_', "'x ", '://u:', 'secret', 'a', 'a.', 'a-', '1', 'a@', 'pass_', 'pass_a_', '_pass', 'api_key', 'eyJaaaaaaaa-', 'a://u:x', 'sk_live_',
      '-Users-a', '-home-a', '305-555-', '-----BEGIN ', 'password="', '"password": \'', ' ', '\t', ' \t', ' \n', '@', 'a@a.', '@a.aa', 'x@y.zz@',
      '<command-a', '<pasted_content', '<pasted_content>', '<system-reminder>', '<local-command-a>', '<command-a>x</command-b>', '</command-a>'].map(u => [JSON.stringify(u), (n) => u.repeat(n)]),
    ['"secret" repeated, then a colon', (n) => 'secret'.repeat(n) + ':'],
    ['"a." repeated, then @', (n) => 'a.'.repeat(n) + '@'],
    ['blanks, then one break', (n) => ' '.repeat(n) + '\nx'],
    ['an @ and 254 characters of dots and letters, each time', (n) => ('@' + 'a.'.repeat(127)).repeat(n / 100)],
    ['one opening tag, closing tags before its ">"', (n) => '<command-a ' + '</command-a'.repeat(n) + '>'],
    ['one tag name of 200,000 letters', (n) => '<command-' + 'a'.repeat(n * 5) + '>x</command-a>'],
  ];
  for (const [label, make] of shapes) {
    const small = make(20_000), large = make(40_000);
    // The best time of each size, the two sizes in turn, so a pause on a busy machine does not land on one size only: 5 rounds,
    // and up to 20 while a pause still shows. More rounds never help a quadratic step: its best time is seconds at this size.
    // Under 1 ms the clock is noise, so the smaller time counts as at least 1 ms.
    let t20 = Infinity, t40 = Infinity;
    const ratio = () => t40 / Math.max(t20, 1);
    for (let i = 0; i < 20 && (i < 5 || t20 >= 250 || t40 >= 250 || ratio() > 2.6); i++) { t20 = Math.min(t20, ms(() => scrub(small))); t40 = Math.min(t40, ms(() => scrub(large))); }
    assert.ok(t20 < 250 && t40 < 250, `${label}: ${t20.toFixed(0)} ms at 20,000, ${t40.toFixed(0)} ms at 40,000`);
    assert.ok(ratio() <= 2.6, `${label}: ratio ${ratio().toFixed(2)} (${t20.toFixed(1)} ms, then ${t40.toFixed(1)} ms)`);
  }
});

test('the bounded rules still take a long value whole', () => {
  // A long name before the "@": a token glued to a host goes with the address.
  assert.equal(scrub(`x ${'a1'.repeat(150)}@host.com y`), 'x [email] y');
  assert.equal(scrub(`git clone https://${'Ab3'.repeat(40)}@git.example.io/team/app`), 'git clone https://[email]/team/app');
  // A JWT whose first part is a certificate chain.
  assert.equal(scrub(`jws eyJ${'hbGc'.repeat(900)}.${'eyJzdWIi'.repeat(4)}.${'c2ln'.repeat(8)} end`), 'jws [token] end');
  // A long password in a connection URL, and many URLs in a row.
  assert.equal(scrub(`postgres://app:${'p4ss!'.repeat(120)}@db.internal:5432/x`), 'postgres://[credentials]@db.internal:5432/x');
  assert.equal(scrub('redis://:pw123456@a redis://:pw123456@b'), 'redis://[credentials]@a redis://[credentials]@b');
  // Blocks and blanks, as before.
  assert.equal(scrub('a <system-reminder>one</system-reminder>b <pasted_content id="1">two</pasted_content>c   \n\n\n\nd'), 'a b c\n\nd');
  assert.equal(scrub('kept <system-reminder>never closed'), 'kept <system-reminder>never closed');
});

test('a 200 KB hostile session file is listed and digested in under 500 ms', async () => {
  const root = tmp('wavex-hostile-');
  // Sixteen turns of 12.5 KB each, every one a run that used to be scanned again from each character.
  const runs = ['a', 'a.', 'a-', 'secret', 'pass_', 'eyJaaaaaaaa-', 'a_', '"a', ' ', '<system-reminder>', '<command-a', 'a://u:x', '1', 'a@', "'x ", '://u:'];
  const lines = runs.flatMap((u, i) => { const text = u.repeat(Math.ceil(12_500 / u.length)); return i % 2 ? [says(text)] : [user(text), says(text)]; });
  const file = put(root, '-work-hostile', ID(9), lines);
  const size = fs.statSync(file).size;
  assert.ok(size >= 200 * 1024, `the file is ${size} bytes`);
  await callTool('get_session_digest', { session_id: ID(9) }, root); // warm up
  let digestMs = Infinity, listMs = Infinity, d;
  for (let i = 0; i < 3; i++) {
    let t = performance.now(); d = await callTool('get_session_digest', { session_id: ID(9) }, root); digestMs = Math.min(digestMs, performance.now() - t);
    t = performance.now(); await callTool('list_sessions', {}, root); listMs = Math.min(listMs, performance.now() - t);
  }
  assert.ok(digestMs < 500, `digest took ${digestMs.toFixed(0)} ms`);
  assert.ok(listMs < 500, `list took ${listMs.toFixed(0)} ms`);
  assert.equal(d.turns, 7); // eight asks, one of them a run of opening command tags, which is not an ask
  assert.ok(JSON.stringify(d).length <= 24 * 1024);
  // The whole command, with the start of Node, stays well inside the page's 90 s wait.
  const t = performance.now();
  const r = await run(['--cli', 'get_session_digest', '--id', ID(9)], withRoot(root));
  assert.equal(r.code, 0, r.err);
  assert.ok(performance.now() - t < 5000);
});

test('the bounded steps give what the regex steps they replace gave', () => {
  // The old steps, kept here as the reference. Safe only on short text: each is quadratic on long hostile text.
  const old = (s) => s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<(pasted_content|command-[a-z-]+|local-command-[a-z-]+)[^>]*>[\s\S]*?<\/\1>/g, '')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  // Pieces that no other rule touches, so the whole scrub can be compared.
  const pieces = ['<system-reminder>', '</system-reminder>', '<command-name>', '</command-name>', '<command-na>', '</command-na>', '<pasted_content id="1">',
    '</pasted_content>', '<local-command-stdout>', '</local-command-stdout>', '<command-', '</command-', '>', '<', 'x', 'y z', ' ', '\t', '\n', ' \n', '\n\n'];
  let seed = 20261115;
  const next = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  let dropped = 0;
  for (let i = 0; i < 4000; i++) {
    let s = '';
    for (let k = next(14) + 1; k > 0; k--) s += pieces[next(pieces.length)];
    const want = old(s);
    assert.equal(scrub(s, 1e6), want, JSON.stringify(s));
    if (want.length < s.trim().length - 12) dropped++;
  }
  assert.ok(dropped > 400, `the mixes must exercise dropped blocks: ${dropped}`);
});
