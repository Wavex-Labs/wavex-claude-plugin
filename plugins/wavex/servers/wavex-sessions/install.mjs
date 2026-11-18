#!/usr/bin/env node
// Adds the wavex-sessions helper to the Claude desktop app. /wavex-shop runs it only after the person says yes.
//   node install.mjs check     says what is there; changes nothing
//   node install.mjs install   copies server.mjs to ~/.wavex/wavex-sessions.mjs, backs up the app's
//                              claude_desktop_config.json, and sets mcpServers["wavex-sessions"],
//                              keeping every other key and every other server as it was, and the file's mode;
//                              when the settings path is a link, it changes the file the link points to
// Prints one JSON object. Exit 0 = done, 2 = refused (nothing was changed). Zero dependencies. Node 18+.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const NAME = 'wavex-sessions';
const HERE = path.dirname(fileURLToPath(import.meta.url));

export function desktopConfigPath({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  if (platform === 'win32' && env.APPDATA) return path.join(env.APPDATA, 'Claude', 'claude_desktop_config.json');
  return null;
}

// Homebrew keeps each Node.js version in its own Cellar folder, which an upgrade removes.
// Prefer the stable link (/opt/homebrew/bin/node, /usr/local/bin/node) when it runs the same binary.
export const NODE_SHIMS = ['/opt/homebrew/bin/node', '/usr/local/bin/node'];
const CELLAR = /\/Cellar\/node(@[0-9]+)?\/[^/]+\/bin\/node$/;
export function pickNode({ execPath = process.execPath, shims = NODE_SHIMS } = {}) {
  const real = (p) => { try { return fs.realpathSync(p); } catch { return null; } };
  if (shims.includes(execPath)) return { node: execPath, node_note: null };
  if (CELLAR.test(execPath)) {
    const self = real(execPath);
    const shim = shims.find((s) => self && real(s) === self);
    if (shim) return { node: shim, node_note: null };
  }
  return { node: execPath, node_note: `The helper runs with the Node.js at ${execPath}. If you upgrade or remove that Node.js, type /wavex-shop again so the helper keeps working.` };
}

export function defaults() {
  const { node, node_note } = pickNode();
  return {
    config: desktopConfigPath(),
    copy: path.join(os.homedir(), '.wavex', 'wavex-sessions.mjs'),
    source: path.join(HERE, 'server.mjs'),
    node,
    node_note,
    nodeVersion: process.versions.node,
    platform: process.platform,
  };
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const refuse = (reason, message) => ({ ok: false, refused: true, reason, message });

// Reads everything and decides; writes nothing.
function inspect(o) {
  if (!o.config) return refuse('no_desktop_app', `The sessions helper works with the Claude desktop app on macOS and Windows. This computer runs ${o.platform}, so nothing was changed.`);
  if (Number(String(o.nodeVersion).split('.')[0]) < 18) return refuse('old_node', `The sessions helper needs Node.js 18 or newer. This computer has ${o.nodeVersion}. Install a newer Node.js from nodejs.org, then type /wavex-shop again.`);
  if (!fs.existsSync(o.source)) return refuse('source_missing', `The helper file is missing from the plugin (${o.source}). Update the plugin with /plugin update wavex@wavex-plugins, then type /wavex-shop again.`);
  const dir = path.dirname(o.config);
  if (!fs.existsSync(dir)) return refuse('no_desktop_app', `I can't find the Claude desktop app's settings folder (${dir}). Install the Claude desktop app and open it once, then type /wavex-shop again.`);
  // A settings path that is a link: change the file it points to, so the link stays.
  let target = o.config, linkedTo = null;
  let isLink = false;
  try { isLink = fs.lstatSync(o.config).isSymbolicLink(); } catch { /* no file yet */ }
  if (isLink) {
    try { target = linkedTo = fs.realpathSync(o.config); } catch {
      return refuse('config_link_broken', `Your Claude app settings file (${o.config}) is a link to a file that does not exist, so nothing was changed. Fix or remove that link, then type /wavex-shop again.`);
    }
  }
  let data = {};
  const exists = fs.existsSync(target);
  if (exists) {
    const raw = fs.readFileSync(target, 'utf8');
    if (raw.trim()) {
      try { data = JSON.parse(raw); } catch { return refuse('config_not_json', `Your Claude app settings file (${o.config}) is not valid JSON, so nothing was changed. Fix that file, then type /wavex-shop again.`); }
    }
  }
  if (!isObject(data)) return refuse('config_not_object', `Your Claude app settings file (${o.config}) does not hold a JSON object, so nothing was changed. Fix that file, then type /wavex-shop again.`);
  if (data.mcpServers !== undefined && !isObject(data.mcpServers)) return refuse('mcpServers_not_object', `mcpServers in your Claude app settings file (${o.config}) is not an object, so nothing was changed. Fix mcpServers in that file, then type /wavex-shop again.`);
  const entry = { command: o.node, args: [o.copy] };
  const have = data.mcpServers?.[NAME];
  const sameEntry = JSON.stringify(have) === JSON.stringify(entry);
  const sameCopy = fs.existsSync(o.copy) && fs.readFileSync(o.copy).equals(fs.readFileSync(o.source));
  return { ok: true, exists, target, linkedTo, data, entry, installed: have !== undefined, current: sameEntry && sameCopy, sameCopy };
}

const where = (o) => ({ config: o.config, copy: o.copy, node: o.node, node_note: o.node_note ?? null });
const linkNote = (r) => (r.linkedTo ? `Your settings file is a link, so the change goes into the file it points to: ${r.linkedTo}.` : null);

export function check(opts = {}) {
  const o = { ...defaults(), ...opts };
  const r = inspect(o);
  if (!r.ok) return { ...r, ...where(o) };
  return { ok: true, ...where(o), linked_to: r.linkedTo, link_note: linkNote(r), installed: r.installed, current: r.current };
}

export function install(opts = {}) {
  const o = { ...defaults(), ...opts };
  const r = inspect(o);
  if (!r.ok) return { ...r, ...where(o) };
  const out = { ok: true, ...where(o), linked_to: r.linkedTo, link_note: linkNote(r), entry: r.entry, backup: null, changed: false };
  if (r.current) return out;
  if (!r.sameCopy) {
    fs.mkdirSync(path.dirname(o.copy), { recursive: true });
    fs.copyFileSync(o.source, o.copy);
  }
  if (JSON.stringify(r.data.mcpServers?.[NAME]) !== JSON.stringify(r.entry)) {
    // Keep the file's mode: a 0600 settings file stays 0600, and so does its backup.
    const mode = r.exists ? fs.statSync(r.target).mode & 0o7777 : null;
    if (r.exists) {
      out.backup = `${o.config}.wavex-backup-${(o.stamp || new Date().toISOString()).replace(/[:.]/g, '-')}`;
      fs.copyFileSync(r.target, out.backup);
      fs.chmodSync(out.backup, mode);
    }
    const data = r.data;
    const servers = data.mcpServers || {};
    servers[NAME] = r.entry;
    data.mcpServers = servers;
    const tmp = `${r.target}.wavex-tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', mode === null ? undefined : { mode });
    fs.renameSync(tmp, r.target);
    if (mode !== null) fs.chmodSync(r.target, mode);
  }
  out.changed = true;
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const mode = process.argv[2];
  if (mode !== 'check' && mode !== 'install') {
    process.stdout.write(JSON.stringify(refuse('bad_input', 'mode: use check or install.')) + '\n');
    process.exit(1);
  }
  const res = mode === 'check' ? check() : install();
  process.stdout.write(JSON.stringify(res, null, 2) + '\n');
  process.exit(res.ok ? 0 : 2);
}
