#!/usr/bin/env node
// bridge-sim: plays the Claude Code session's part of the WaveX bridge with no Claude, no page and no network.
// It follows plugins/wavex/skills/wavex-bridge/SKILL.md, steps 2 to 6 and "Preload", against:
//   - one JSON file that stands in for the page's own data: { "docs": { "<path>": { "version": 1, "data": { ... } } } }
//   - the real sessions reader, run in its --cli mode on a sessions folder you name.
//
//   node scripts/bridge-sim.mjs --data <file.json> --sessions-root <folder> [--preload] [--woken] [--label cc-sim001] [--node <path to node>]
//
// It prints one JSON line: what it answered, what it left, and the reply line a comment would get.
// Two operations need a model and are left pending here once their checks pass: draft_listing and run_steps.
// In save_session a real session writes the one-sentence summary; here it is the digest's title.
// This is a stand-in for local proof (ruling R1). It is not the live X1 check.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const READER = path.resolve(HERE, '..', 'plugins', 'wavex', 'servers', 'wavex-sessions', 'server.mjs');
export const PLAYBOOK_VERSION = '0.5.0';
export const OPS = ['ping', 'preload', 'list_sessions', 'session_digest', 'draft_listing', 'save_session', 'run_steps'];
const NEEDS_READER = new Set(['preload', 'list_sessions', 'session_digest', 'draft_listing', 'save_session']);
const NEEDS_MODEL = new Set(['draft_listing', 'run_steps']);
export const TAG = /^\[wavex-bridge v=1 req=(r[0-9a-z]{6,30}) op=([a-z_]{1,32})\]$/;
const REQ_ID = /^r[0-9a-z]{6,30}$/;
const SESSION_ID = /^[A-Za-z0-9-]{8,80}$/;
const QUERY = /^[\p{L}\p{N} ._-]{1,80}$/u;
const DOC_MAX = 256 * 1024;

export const MESSAGES = {
  unsupported_op: 'op: this plugin cannot do that request. It can do ping, preload, list_sessions, session_digest, draft_listing, save_session and run_steps. Update the WaveX plugin in Claude Code, then click again.',
  unsupported_version: 'v: this request uses another bridge version. This plugin speaks version 1. Update the WaveX plugin in Claude Code, then click again.',
  limit: 'limit: use a whole number from 1 to 50.',
  query: 'query: use letters, digits, spaces, dots, dashes and underscores only, at most 80 characters.',
  session_id: 'session_id: pick a session from the list on your page.',
  run_id: 'run_id: start the run on your page, then try again.',
  no_node: 'Node.js is not installed on this computer, so your sessions cannot be read. Install Node.js 18 or newer from nodejs.org, then click again.',
  reader_failed: 'The sessions reader did not answer. Type /wavex-shop in Claude Code to set it up again, then click again.',
  not_found: 'session_id: no session with that id is on this computer. Refresh the list on your page and pick again.',
  too_large: 'The answer is larger than one row can hold. Ask for fewer sessions (limit), then click again.',
};

// ── The page's data: the same rules ArtifactData keeps ──
const SEGMENT = /^(?!\.\.?$)[A-Za-z0-9_\-.~:@+]{1,200}$/;
const refuse = (code, message) => Object.assign(new Error(message), { code });
export class Store {
  constructor(docs = {}) { this.docs = docs; }
  static load(file) { return new Store(JSON.parse(fs.readFileSync(file, 'utf8')).docs || {}); }
  save(file) { fs.writeFileSync(file, JSON.stringify({ docs: this.docs }, null, 1) + '\n'); }
  static docPath(collection, id) {
    const parts = `${collection}/${id}`.split('/');
    if (!parts.every(p => SEGMENT.test(p))) throw refuse('invalid_argument', `"${collection}/${id}" holds a part that is not allowed in a row path.`);
    // A collection has an odd number of parts, so a row has an even number: sessions/d/<id> is not a row.
    if (parts.length % 2 !== 0) throw refuse('invalid_argument', `"${collection}/${id}" is not a row path: a row path has an even number of parts.`);
    return parts.join('/');
  }
  get(collection, id) {
    const d = this.docs[Store.docPath(collection, id)];
    return d ? { exists: true, version: d.version, data: structuredClone(d.data) } : { exists: false };
  }
  list(collection) {
    const prefix = collection + '/';
    return Object.entries(this.docs)
      .filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
      .map(([p, d]) => ({ id: p.slice(prefix.length), version: d.version, data: structuredClone(d.data) }));
  }
  query(collection, field, value) { return this.list(collection).filter(d => d.data?.[field] === value); }
  // All or nothing. A write to a row that exists must carry if_version; a new row must not.
  batch(writes) {
    if (!writes.length || writes.length > 50) throw refuse('invalid_argument', 'A batch holds 1 to 50 writes.');
    const seen = new Set();
    const plan = writes.map((w, i) => {
      const p = Store.docPath(w.collection, w.doc_id);
      if (seen.has(p)) throw refuse('invalid_argument', `Write ${i + 1} names ${p} twice in one batch.`);
      seen.add(p);
      const cur = this.docs[p];
      if (cur && w.if_version === undefined) throw refuse('version_required', `Write ${i + 1}: ${p} exists; pass if_version ${cur.version}.`);
      if (cur && w.if_version !== cur.version) throw refuse('version_conflict', `Write ${i + 1}: ${p} is at version ${cur.version}, not ${w.if_version}.`);
      if (!cur && w.if_version !== undefined) throw refuse('not_found', `Write ${i + 1}: ${p} does not exist, so it has no version.`);
      if (w.op === 'delete') return { p, del: true };
      if (!cur && w.op === 'update') throw refuse('not_found', `Write ${i + 1}: ${p} does not exist, so it cannot be updated.`);
      if (!w.data || typeof w.data !== 'object' || Array.isArray(w.data)) throw refuse('invalid_argument', `Write ${i + 1}: the row must be a JSON object.`);
      const data = w.op === 'update' ? { ...cur.data, ...w.data } : w.data;
      if (Buffer.byteLength(JSON.stringify(data)) > DOC_MAX) throw refuse('too_large', `Write ${i + 1}: ${p} is over 256 KiB.`);
      return { p, data: structuredClone(data), version: (cur?.version || 0) + 1 };
    });
    const versions = {};
    for (const w of plan) {
      if (w.del) delete this.docs[w.p];
      else { this.docs[w.p] = { version: w.version, data: w.data }; versions[w.p] = w.version; }
    }
    return versions;
  }
}

// ── The reader, in its --cli mode ──
export function makeReader({ nodePath = process.execPath, readerPath = READER, sessionsRoot } = {}) {
  return (args) => {
    const r = spawnSync(nodePath, [readerPath, '--cli', ...args], {
      encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, ...(sessionsRoot && { WAVEX_SESSIONS_ROOT: sessionsRoot }) },
    });
    if (r.error?.code === 'ENOENT') return { kind: 'no_node' };
    let json; try { json = JSON.parse(r.stdout); } catch { return { kind: 'failed' }; }
    if (r.status === 0) return { kind: 'ok', json };
    if (r.status === 2 && json?.error?.code) return { kind: 'refused', code: json.error.code };
    return { kind: 'failed' };
  };
}

// Step 5, checks 1 to 3. Returns null when the row is good, or { code, message }.
export function checkRow(row) {
  if (row.v !== 1) return { code: 'unsupported_version', message: MESSAGES.unsupported_version };
  if (typeof row.op !== 'string' || !OPS.includes(row.op)) return { code: 'unsupported_op', message: MESSAGES.unsupported_op };
  const a = row.args && typeof row.args === 'object' && !Array.isArray(row.args) ? row.args : {};
  if (row.op === 'list_sessions') {
    if (a.limit !== undefined && !(Number.isInteger(a.limit) && a.limit >= 1 && a.limit <= 50)) return { code: 'bad_input', message: MESSAGES.limit };
    if (a.query !== undefined && !(typeof a.query === 'string' && QUERY.test(a.query))) return { code: 'bad_input', message: MESSAGES.query };
  }
  if (['session_digest', 'draft_listing', 'save_session'].includes(row.op)) {
    if (typeof a.session_id !== 'string' || !SESSION_ID.test(a.session_id)) return { code: 'bad_input', message: MESSAGES.session_id };
  }
  if (row.op === 'run_steps') {
    if (typeof a.run_id !== 'string' || !SESSION_ID.test(a.run_id)) return { code: 'bad_input', message: MESSAGES.run_id };
  }
  return null;
}

const readerError = (r) => {
  if (r.kind === 'no_node') return { code: 'no_node', message: MESSAGES.no_node };
  if (r.kind === 'refused' && r.code === 'not_found') return { code: 'not_found', message: MESSAGES.not_found };
  return { code: 'reader_failed', message: MESSAGES.reader_failed };
};

// "Preload": the 30 newest sessions go to sessions/index, the digests of the 8 newest that are not setup go under it.
export function preload(store, reader, { label, ts }) {
  const list = reader(['list_sessions', '--limit', '30']);
  if (list.kind !== 'ok') return { error: readerError(list) };
  const picks = list.json.sessions.filter(s => s.kind !== 'setup').slice(0, 8);
  const digests = [];
  for (const s of picks) {
    const d = reader(['get_session_digest', '--id', s.id]);
    if (d.kind === 'ok') digests.push(d.json); // one that fails is left out
  }
  const index = store.get('sessions', 'index');
  const old = store.list('sessions/index/d');
  const keep = new Set(digests.map(d => d.id));
  const versions = store.batch([
    { op: 'set', collection: 'sessions', doc_id: 'index', data: list.json, ...(index.exists && { if_version: index.version }) },
    ...digests.map(d => {
      const cur = old.find(o => o.id === d.id);
      return { op: 'set', collection: 'sessions/index/d', doc_id: d.id, data: d, ...(cur && { if_version: cur.version }) };
    }),
    ...old.filter(o => !keep.has(o.id)).map(o => ({ op: 'delete', collection: 'sessions/index/d', doc_id: o.id, if_version: o.version })),
  ]);
  store.batch([{ op: 'update', collection: 'sessions', doc_id: 'index', if_version: versions['sessions/index'],
    data: { ...(ts && { ts }), session: label, playbook_version: PLAYBOOK_VERSION } }]);
  return { data: { count: list.json.count, digests: digests.length } };
}

// One operation that needs no model. Returns { data } or { error }.
function doOp(row, store, reader, ctx) {
  const a = row.args || {};
  if (row.op === 'ping') return { data: { pong: true, playbook_version: PLAYBOOK_VERSION, ops: OPS } };
  if (ctx.node !== 'ok') return { error: readerError({ kind: ctx.node }) };
  if (row.op === 'preload') return preload(store, reader, ctx);
  if (row.op === 'list_sessions') {
    const r = reader(['list_sessions', '--limit', String(a.limit ?? 20), ...(a.query !== undefined ? ['--query', a.query] : [])]);
    if (r.kind !== 'ok') return { error: readerError(r) };
    return { data: r.json.count ? r.json : { ...r.json, hint: 'No Claude Code sessions were found in your home folder on this computer.' } };
  }
  const r = reader(['get_session_digest', '--id', a.session_id]);
  if (r.kind !== 'ok') return { error: readerError(r) };
  if (row.op === 'session_digest') return { data: { digest: r.json } };
  // save_session: the page asks the person and calls the connector. A real session writes the summary sentence.
  const d = r.json;
  return { data: { digest: d, save: { title: d.title, summary: d.title, digest: { asks: d.asks, results: d.results, tools_used: d.tools_used }, source: 'claude_code' } } };
}

// Steps 2 to 6 for one page. opts: { reader, label, woken, withPreload }.
export function drain(store, { reader, label = 'cc-sim001', woken = false, withPreload = false } = {}) {
  // Step 2: is there Node, and what time is it? The newest session is the one being written now.
  const first = reader(['list_sessions', '--limit', '1']);
  const node = first.kind === 'ok' ? 'ok' : first.kind === 'no_node' ? 'no_node' : 'failed';
  const ts = first.kind === 'ok' ? first.json.sessions[0]?.last_active : undefined;
  const stamp = { session: label, ...(ts && { ts }) };
  const ctx = { node, label, ts };
  const out = { answered: [], errors: [], skipped: [], left_pending: [], already_answered: [], node, preload: null, reply: null };

  // Step 3: the pending rows, oldest first. Rows with a bad id are skipped untouched.
  const pending = store.query('req', 'status', 'pending');
  const taken = [];
  for (const d of pending.sort((x, y) => (Number(x.data.ts) || 0) - (Number(y.data.ts) || 0)).slice(0, 40)) {
    if (!REQ_ID.test(d.id)) { out.skipped.push(d.id); continue; }
    const bad = checkRow(d.data);
    // A row that needs a model and passed its checks stays pending for a real session.
    if (!bad && NEEDS_MODEL.has(d.data.op) && !(NEEDS_READER.has(d.data.op) && node !== 'ok')) { out.left_pending.push(d.id); continue; }
    taken.push({ id: d.id, reqVersion: d.version, row: d.data, bad });
  }

  // Step 4: "working" for every row taken, and bridge/status, in one batch.
  const status = store.get('bridge', 'status');
  const work = [];
  for (const t of taken) {
    const cur = store.get('res', t.id);
    if (cur.exists && (cur.data.state === 'done' || cur.data.state === 'error')) {
      store.batch([{ op: 'update', collection: 'req', doc_id: t.id, if_version: t.reqVersion, data: { status: 'done' } }]);
      out.already_answered.push(t.id); t.drop = true; continue;
    }
    work.push({ op: 'set', collection: 'res', doc_id: t.id, ...(cur.exists && { if_version: cur.version }),
      data: { reply_to: t.id, state: 'working', progress: 'Started', ...stamp } });
  }
  const versions = store.batch([...work, {
    op: 'set', collection: 'bridge', doc_id: 'status', ...(status.exists && { if_version: status.version }),
    data: { session: label, ...(ts && { last_seen: ts }), playbook_version: PLAYBOOK_VERSION, ops: OPS, armed: woken },
  }]);

  // Step 5: do each row, then answer it and close the request in one batch.
  for (const t of taken.filter(x => !x.drop)) {
    let r = t.bad ? { error: t.bad } : doOp(t.row, store, reader, ctx);
    let answer = r.error
      ? { reply_to: t.id, state: 'error', error: r.error, ...stamp }
      : { reply_to: t.id, state: 'done', progress: 'Done', data: r.data, ...stamp };
    if (Buffer.byteLength(JSON.stringify(answer)) > DOC_MAX) {
      r = { error: { code: 'too_large', message: MESSAGES.too_large } };
      answer = { reply_to: t.id, state: 'error', error: r.error, ...stamp };
    }
    store.batch([
      { op: 'set', collection: 'res', doc_id: t.id, if_version: versions[`res/${t.id}`], data: answer },
      { op: 'update', collection: 'req', doc_id: t.id, if_version: t.reqVersion, data: { status: 'done' } },
    ]);
    (r.error ? out.errors : out.answered).push({ id: t.id, op: typeof t.row.op === 'string' ? t.row.op.slice(0, 32) : null, ...(r.error && { code: r.error.code }) });
    if (!r.error && t.row.op === 'preload') out.preload = r.data;
  }

  if (withPreload) out.preload = node === 'ok' ? (preload(store, reader, ctx).data || null) : null;

  // Step 6: the one line a comment thread gets. Numbers only.
  if (woken) {
    const n = out.answered.length, m = out.errors.length;
    out.reply = !n && !m ? 'Nothing was waiting on your page.'
      : m ? `Done. ${n} answered, ${m} could not be done. Your page shows why.`
      : `Done. ${n} request(s) answered on your page.`;
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  const opt = (name) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
  const data = opt('--data'), sessionsRoot = opt('--sessions-root');
  if (!data || !sessionsRoot) {
    process.stdout.write(JSON.stringify({ error: { code: 'bad_input', message: '--data and --sessions-root are both needed. Example: node scripts/bridge-sim.mjs --data page.json --sessions-root ./sessions' } }) + '\n');
    process.exitCode = 2;
  } else {
    const store = Store.load(data);
    const reader = makeReader({ nodePath: opt('--node') || process.execPath, sessionsRoot });
    const out = drain(store, { reader, label: opt('--label') || 'cc-sim001', woken: argv.includes('--woken'), withPreload: argv.includes('--preload') });
    store.save(data);
    process.stdout.write(JSON.stringify(out) + '\n');
  }
}
