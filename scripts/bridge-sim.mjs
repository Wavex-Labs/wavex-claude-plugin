#!/usr/bin/env node
// bridge-sim: plays the Claude Code session's part of the WaveX bridge with no Claude, no page and no network.
// It follows plugins/wavex/skills/wavex-bridge/SKILL.md, steps 2 to 6 and "Preload", against:
//   - one JSON file that stands in for the page's own data: { "docs": { "<path>": { "version": 1, "data": { ... } } } }
//   - the real commands the skill runs: the sessions reader (server.mjs --cli) and the code part (bridge.mjs)
//   - a JSON file that stands in for the person's wavex connector, and a folder that stands in for ~/.claude/skills
//
//   node scripts/bridge-sim.mjs --data <file.json> --sessions-root <folder> [--preload] [--woken] [--label cc-sim001]
//        [--connector <fixture.json>] [--skills <folder>] [--apps gmail,canva] [--node <path to node>]
//
// --woken plays a wake by an artifact-auto-react notification: no second reply, the thread is resolved.
// --connector: { "download_automation": { "<slug>": <the answer> } }. Without the flag the session has no connector;
// a fixture with no "download_automation" is a connector that does not offer the tool yet.
//
// It prints one JSON line: what it answered, what it left, and what it did with the thread.
// Two operations need a model and are left pending here once their checks pass: draft_listing and run_steps.
// In save_session a real session writes the one-sentence summary; here it is the digest's title.
// In run_owned a real session writes each step's answer; here a prompt step answers with its own filled-in text.
// This is a stand-in for local proof (ruling R1). It is not the live check.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  OPS, RESERVED_OPS, TAG, REQ_ID, MESSAGES, PLAYBOOK_VERSION, BOUGHT_LINE, checkRow,
  readDownload, fillPlaceholders, stepStopsAtDraft,
} from '../plugins/wavex/servers/wavex-sessions/bridge.mjs';

export { OPS, RESERVED_OPS, TAG, MESSAGES, PLAYBOOK_VERSION, checkRow };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVERS = path.resolve(HERE, '..', 'plugins', 'wavex', 'servers', 'wavex-sessions');
export const READER = path.join(SERVERS, 'server.mjs');
export const BRIDGE = path.join(SERVERS, 'bridge.mjs');
const NEEDS_NODE = new Set(['preload', 'list_sessions', 'session_digest', 'draft_listing', 'save_session', 'install_automation']);
const NEEDS_MODEL = new Set(['draft_listing', 'run_steps']);
const DOC_MAX = 256 * 1024;

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

// ── The two commands the skill runs ──
// reader(args) runs server.mjs --cli; reader.bridge(args) runs bridge.mjs. Same Node, same sessions folder.
export function makeReader({ nodePath = process.execPath, readerPath = READER, bridgePath = BRIDGE, sessionsRoot } = {}) {
  const run = (argv) => {
    const r = spawnSync(nodePath, argv, {
      encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, ...(sessionsRoot && { WAVEX_SESSIONS_ROOT: sessionsRoot }) },
    });
    if (r.error?.code === 'ENOENT') return { kind: 'no_node' };
    let json; try { json = JSON.parse(r.stdout); } catch { return { kind: 'failed' }; }
    if (r.status === 0) return { kind: 'ok', json };
    if (r.status === 2 && json?.error?.code) return { kind: 'refused', code: json.error.code, message: json.error.message };
    return { kind: 'failed' };
  };
  const reader = (args) => run([readerPath, '--cli', ...args]);
  reader.bridge = (args) => run([bridgePath, ...args]);
  return reader;
}

// The stand-in for the person's wavex connector. undefined: no connector in the session.
export function makeConnector(fixture) {
  if (!fixture) return undefined;
  const conn = {};
  if (fixture.download_automation) {
    conn.download_automation = ({ id }) => {
      const answer = Object.prototype.hasOwnProperty.call(fixture.download_automation, id) ? fixture.download_automation[id] : undefined;
      if (!answer) throw Object.assign(new Error('not owned'), { code: 'not_owned' });
      return structuredClone(answer);
    };
  }
  return conn;
}

const readerError = (r) => {
  if (r.kind === 'no_node') return { code: 'no_node', message: MESSAGES.no_node };
  if (r.kind === 'refused' && r.code === 'not_found') return { code: 'not_found', message: MESSAGES.not_found };
  return { code: 'reader_failed', message: MESSAGES.reader_failed };
};
const pin = (cur) => (cur.exists ? { if_version: cur.version } : {});

// "Preload": the command writes the rows as files; one batch sends them and removes the digests that are no longer kept.
export function preload(store, reader, { label } = {}) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wavex-bridge-sim-'));
  try {
    const r = reader.bridge(['preload', '--limit', '30', '--digests', '8', '--out', work, ...(label ? ['--label', label] : [])]);
    if (r.kind !== 'ok') return { error: readerError(r) };
    const old = store.list('sessions/index/d');
    const keep = new Set(r.json.keep);
    store.batch([
      ...r.json.writes.map(w => ({
        op: w.op, collection: w.collection, doc_id: w.doc_id, data: JSON.parse(fs.readFileSync(w.file_path, 'utf8')),
        ...pin(store.get(w.collection, w.doc_id)),
      })),
      ...old.filter(o => !keep.has(o.id)).map(o => ({ op: 'delete', collection: 'sessions/index/d', doc_id: o.id, if_version: o.version })),
    ]);
    return { data: { count: r.json.count, digests: r.json.digests } };
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}

// install_automation: download with the connector, write the answer next to the skill, let make-skill write the skill.
function install(row, store, reader, ctx) {
  const slug = row.args.slug;
  if (!ctx.connector) return { error: { code: 'no_connector', message: MESSAGES.no_connector } };
  if (typeof ctx.connector.download_automation !== 'function') return { error: { code: 'not_switched_on', message: MESSAGES.not_switched_on } };
  let answer;
  try { answer = ctx.connector.download_automation({ id: slug }); } catch (e) {
    return { error: ['not_found', 'not_owned', 'forbidden'].includes(e.code) ? { code: 'not_owned', message: MESSAGES.not_owned } : { code: 'connector_refused', message: 'The wavex connector refused the download. Click Install again later.' } };
  }
  if (!answer || answer.slug !== slug) return { error: { code: 'bad_definition', message: 'The automation WaveX sent is not the one that was asked for. Nothing was installed.' } };
  const text = JSON.stringify(answer);
  if (text.length > 200000) return { error: { code: 'too_large', message: 'The automation WaveX sent is too large to install. Nothing was installed.' } };
  const folder = path.join(ctx.skillsDir, `wavex-${slug}`);
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, 'automation.json');
  fs.writeFileSync(file, text);
  const r = reader.bridge(['make-skill', file, '--out', ctx.skillsDir]);
  if (r.kind === 'refused') return { error: { code: r.code, message: r.message } };
  if (r.kind !== 'ok') return { error: readerError(r) };
  const { slug: s, name, version, command, owned } = r.json;
  return {
    data: { slug: s, name, version, command, installed: true }, progress: 'Installed in your Claude Code',
    writes: [{ op: 'set', collection: 'owned', doc_id: slug, data: owned, ...pin(store.get('owned', slug)) }],
  };
}

// run_owned: the installed skill's steps, in order. No connector call, no server run, no credits.
function runOwned(row, ctx, progress) {
  const { slug, inputs = {} } = row.args;
  const folder = path.join(ctx.skillsDir, `wavex-${slug}`);
  let def;
  try {
    const skill = fs.readFileSync(path.join(folder, 'SKILL.md'), 'utf8');
    if (!new RegExp(`^---\\n[\\s\\S]*?\\n---\\n\\n${BOUGHT_LINE} `).test(skill)) throw new Error('not a bought skill');
    def = readDownload(JSON.parse(fs.readFileSync(path.join(folder, 'automation.json'), 'utf8')));
  } catch { return { error: { code: 'not_installed', message: MESSAGES.not_installed } }; }
  if (def.inputs.some(x => x.required && !(typeof inputs[x.key] === 'string' && inputs[x.key].trim()))) {
    return { error: { code: 'bad_input', message: 'inputs: answer every required question on your page.' } };
  }
  const outputs = {}, steps = [], drafts = [];
  let note;
  for (const [i, step] of def.steps.entries()) {
    const filled = fillPlaceholders(step.prompt, inputs, outputs);
    let output = filled, draft = false;
    if (stepStopsAtDraft(step)) {
      // A step that would send, post, pay or delete stops at a draft. The act is never done here.
      draft = true; drafts.push(step.id);
      note = `Step ${i + 1} stopped at a draft. Nothing was sent.`;
    } else if (step.kind === 'app') {
      if (!ctx.apps.has(step.app)) return { error: { code: 'step_not_allowed', message: 'A step needs an app that is not connected in this Claude Code session. Nothing was charged. Connect the app, then run it again.' } };
      output = `[${step.app}${step.tool ? `.${step.tool}` : ''}] ${filled}`;
    }
    outputs[step.id] = output;
    steps.push({ id: step.id, output, ...(draft && { draft: true }) });
    progress(`Step ${i + 1} of ${def.steps.length}`);
  }
  return { data: { slug, ok: true, result: { steps }, drafts, ...(note && { note }) } };
}

// One operation that needs no model. Returns { data, progress?, writes? } or { error }.
function doOp(row, store, reader, ctx, progress) {
  const a = row.args || {};
  if (row.op === 'ping') return { data: { pong: true, playbook_version: PLAYBOOK_VERSION, ops: OPS, reserved: RESERVED_OPS } };
  if (row.op === 'run_owned') return runOwned(row, ctx, progress);
  if (ctx.node !== 'ok') return { error: readerError({ kind: ctx.node }) };
  if (row.op === 'preload') return preload(store, reader, ctx);
  if (row.op === 'install_automation') return install(row, store, reader, ctx);
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

// Steps 2 to 6 for one page.
// opts: { reader, label, woken, withPreload, connector, skillsDir, apps }.
// woken: true = an artifact-auto-react notification (no second reply, the thread is resolved);
//        'comment' = a comment that came with its text and no automatic reply (one reply line, then resolved).
export function drain(store, { reader, label = 'cc-sim001', woken = false, withPreload = false, connector, skillsDir, apps = [] } = {}) {
  // Step 2: is there Node, and what time is it? The clock is the "now" command. Without Node the times are left out.
  const first = reader.bridge(['now']);
  const node = first.kind === 'ok' ? 'ok' : first.kind === 'no_node' ? 'no_node' : 'failed';
  const ts = first.kind === 'ok' ? first.json.ts : undefined;
  const stamp = { session: label, ...(ts && { ts }) };
  const ctx = { node, label, ts, connector, skillsDir, apps: new Set(apps) };
  const out = { answered: [], errors: [], skipped: [], left_pending: [], already_answered: [], node, preload: null, reply: null, thread: null };

  // Step 3: the pending rows, oldest first. Rows with a bad id are skipped untouched.
  const pending = store.query('req', 'status', 'pending');
  const taken = [];
  for (const d of pending.sort((x, y) => (Number(x.data.ts) || 0) - (Number(y.data.ts) || 0)).slice(0, 40)) {
    if (!REQ_ID.test(d.id)) { out.skipped.push(d.id); continue; }
    const bad = checkRow(d.data);
    // A row that needs a model and passed its checks stays pending for a real session.
    if (!bad && NEEDS_MODEL.has(d.data.op) && !(NEEDS_NODE.has(d.data.op) && node !== 'ok')) { out.left_pending.push(d.id); continue; }
    // So does a row that needs the skills folder when the sim was given none.
    if (!bad && ['install_automation', 'run_owned'].includes(d.data.op) && !skillsDir) { out.left_pending.push(d.id); continue; }
    taken.push({ id: d.id, reqVersion: d.version, row: d.data, bad });
  }

  // Step 4: "working" for every row taken, and bridge/status, in one batch.
  // A request is answered once: an answer that already stands (done or error) only closes its request.
  const status = store.get('bridge', 'status');
  const work = [];
  for (const t of taken) {
    const cur = store.get('res', t.id);
    if (cur.exists && (cur.data.state === 'done' || cur.data.state === 'error')) {
      store.batch([{ op: 'update', collection: 'req', doc_id: t.id, if_version: t.reqVersion, data: { status: 'done' } }]);
      out.already_answered.push(t.id); t.drop = true; continue;
    }
    work.push({ op: 'set', collection: 'res', doc_id: t.id, ...pin(cur),
      data: { reply_to: t.id, state: 'working', progress: 'Started', ...stamp } });
  }
  const versions = store.batch([...work, {
    op: 'set', collection: 'bridge', doc_id: 'status', ...pin(status),
    data: { session: label, ...(ts && { last_seen: ts }), playbook_version: PLAYBOOK_VERSION, ops: OPS, reserved: RESERVED_OPS, armed: !!woken },
  }]);

  // Step 5: do each row, then answer it and close the request in one batch.
  for (const t of taken.filter(x => !x.drop)) {
    const key = `res/${t.id}`;
    // Progress is mirrored into the answer row while the steps run, each write pinned.
    const progress = (text) => { Object.assign(versions, store.batch([{ op: 'update', collection: 'res', doc_id: t.id, if_version: versions[key], data: { progress: text } }])); };
    let r = t.bad ? { error: t.bad } : doOp(t.row, store, reader, ctx, progress);
    let answer = r.error
      ? { reply_to: t.id, state: 'error', error: r.error, ...stamp }
      : { reply_to: t.id, state: 'done', progress: r.progress || 'Done', data: r.data, ...stamp };
    if (Buffer.byteLength(JSON.stringify(answer)) > DOC_MAX) {
      r = { error: { code: 'too_large', message: MESSAGES.too_large } };
      answer = { reply_to: t.id, state: 'error', error: r.error, ...stamp };
    }
    store.batch([
      { op: 'set', collection: 'res', doc_id: t.id, if_version: versions[key], data: answer },
      { op: 'update', collection: 'req', doc_id: t.id, if_version: t.reqVersion, data: { status: 'done' } },
      ...(r.error ? [] : r.writes || []),
    ]);
    (r.error ? out.errors : out.answered).push({ id: t.id, op: typeof t.row.op === 'string' ? t.row.op.slice(0, 32) : null, ...(r.error && { code: r.error.code }) });
    if (!r.error && t.row.op === 'preload') out.preload = r.data;
  }

  if (withPreload) out.preload = node === 'ok' ? (preload(store, reader, ctx).data || null) : null;

  // Step 6. Woken by an artifact-auto-react notification: the automatic reply is already there, so no second reply;
  // the thread is resolved. A comment that came with its text gets one line, numbers only, and is resolved too.
  if (woken) out.thread = 'resolved';
  if (woken === 'comment') {
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
    const fixture = opt('--connector');
    const out = drain(store, {
      reader, label: opt('--label') || 'cc-sim001', woken: argv.includes('--woken'), withPreload: argv.includes('--preload'),
      connector: fixture ? makeConnector(JSON.parse(fs.readFileSync(fixture, 'utf8'))) : undefined,
      skillsDir: opt('--skills'), apps: (opt('--apps') || '').split(',').filter(Boolean),
    });
    store.save(data);
    process.stdout.write(JSON.stringify(out) + '\n');
  }
}
