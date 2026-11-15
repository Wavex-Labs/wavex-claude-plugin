import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { desktopConfigPath, check, install, pickNode, NAME } from './install.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(HERE, 'server.mjs');
const made = [];
const tmp = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); made.push(d); return d; };
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

function setup({ config } = {}) {
  const home = tmp('wavex-install-');
  const dir = path.join(home, 'Claude');
  fs.mkdirSync(dir);
  const file = path.join(dir, 'claude_desktop_config.json');
  if (config !== undefined) fs.writeFileSync(file, config);
  return { home, opts: { config: file, copy: path.join(home, '.wavex', 'wavex-sessions.mjs'), source: SOURCE, node: '/usr/local/bin/node', nodeVersion: '22.1.0', platform: 'darwin', stamp: '2026-11-15T12:00:00.000Z' } };
}
const backups = (o) => fs.readdirSync(path.dirname(o.config)).filter(f => f.includes('.wavex-backup-'));

test('settings file path per platform', () => {
  assert.equal(desktopConfigPath({ platform: 'darwin', home: '/h' }), path.join('/h', 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'));
  assert.equal(desktopConfigPath({ platform: 'win32', env: { APPDATA: 'C:\\AppData' } }), path.join('C:\\AppData', 'Claude', 'claude_desktop_config.json'));
  assert.equal(desktopConfigPath({ platform: 'linux', home: '/h' }), null);
  assert.equal(check({ ...setup().opts, config: null, platform: 'linux' }).reason, 'no_desktop_app');
});

test('no settings file yet: makes one with only the helper, copies the server, no backup', () => {
  const { opts } = setup();
  assert.deepEqual([check(opts).installed, check(opts).current], [false, false]);
  const r = install(opts);
  assert.equal(r.ok, true);
  assert.equal(r.changed, true);
  assert.equal(r.backup, null);
  assert.deepEqual(JSON.parse(fs.readFileSync(opts.config, 'utf8')), { mcpServers: { [NAME]: { command: opts.node, args: [opts.copy] } } });
  assert.ok(fs.readFileSync(opts.copy).equals(fs.readFileSync(SOURCE)));
  assert.equal(check(opts).current, true);
});

test('keeps every other key and server, backs up the original, and a second run changes nothing', () => {
  const original = JSON.stringify({ globalShortcut: 'Cmd+Space', mcpServers: { filesystem: { command: 'npx', args: ['-y', 'fs', '/x'], env: { A: '1' } } }, preferences: { theme: 'dark' } }, null, 4);
  const { opts } = setup({ config: original });
  const r = install(opts);
  assert.equal(r.changed, true);
  assert.equal(fs.readFileSync(r.backup, 'utf8'), original);
  const after = JSON.parse(fs.readFileSync(opts.config, 'utf8'));
  const before = JSON.parse(original);
  assert.deepEqual(after.mcpServers.filesystem, before.mcpServers.filesystem);
  assert.deepEqual(after.preferences, before.preferences);
  assert.equal(after.globalShortcut, before.globalShortcut);
  assert.deepEqual(Object.keys(after), Object.keys(before));
  assert.deepEqual(after.mcpServers[NAME], { command: opts.node, args: [opts.copy] });
  const again = install(opts);
  assert.equal(again.changed, false);
  assert.equal(backups(opts).length, 1);
});

test('a stale helper entry is replaced; other servers stay', () => {
  const { opts } = setup({ config: JSON.stringify({ mcpServers: { [NAME]: { command: 'node', args: ['/old.mjs'] }, other: { command: 'x' } } }) });
  assert.deepEqual([check(opts).installed, check(opts).current], [true, false]);
  install(opts);
  const after = JSON.parse(fs.readFileSync(opts.config, 'utf8'));
  assert.deepEqual(after.mcpServers, { [NAME]: { command: opts.node, args: [opts.copy] }, other: { command: 'x' } });
});

test('refuses and changes nothing: bad JSON, a non-object, bad mcpServers, missing folder, old node', () => {
  for (const [config, reason] of [['{ not json', 'config_not_json'], ['[1,2]', 'config_not_object'], ['{"mcpServers":[]}', 'mcpServers_not_object']]) {
    const { opts } = setup({ config });
    const r = install(opts);
    assert.equal(r.ok, false);
    assert.equal(r.reason, reason);
    assert.match(r.message, /nothing was changed/);
    assert.equal(fs.readFileSync(opts.config, 'utf8'), config);
    assert.equal(fs.existsSync(opts.copy), false);
    assert.equal(backups(opts).length, 0);
  }
  const { home, opts } = setup();
  const gone = { ...opts, config: path.join(home, 'NoApp', 'claude_desktop_config.json') };
  assert.equal(install(gone).reason, 'no_desktop_app');
  assert.equal(fs.existsSync(path.dirname(gone.config)), false);
  assert.equal(install({ ...opts, nodeVersion: '16.20.0' }).reason, 'old_node');
  assert.equal(fs.existsSync(opts.config), false);
});

const modeOf = (f) => fs.statSync(f).mode & 0o777;

test('keeps the settings file mode: a 0600 file stays 0600, and so does its backup', () => {
  const { opts } = setup({ config: JSON.stringify({ mcpServers: { other: { command: 'x', env: { TOKEN: 'abc' } } } }) });
  fs.chmodSync(opts.config, 0o600);
  const r = install(opts);
  assert.equal(r.changed, true);
  assert.equal(modeOf(opts.config), 0o600);
  assert.equal(modeOf(r.backup), 0o600);
  assert.ok(JSON.parse(fs.readFileSync(opts.config, 'utf8')).mcpServers[NAME]);
  assert.equal(fs.existsSync(`${opts.config}.wavex-tmp`), false);
  fs.chmodSync(opts.config, 0o640);
  install({ ...opts, node: '/opt/homebrew/bin/node' });
  assert.equal(modeOf(opts.config), 0o640);
});

test('a settings path that is a link: writes the file it points to, keeps the link and the mode, and says so', () => {
  const { opts } = setup();
  const realDir = tmp('wavex-install-real-');
  const real = path.join(realDir, 'claude_desktop_config.json');
  const original = JSON.stringify({ mcpServers: { other: { command: 'x' } } });
  fs.writeFileSync(real, original);
  fs.chmodSync(real, 0o600);
  fs.symlinkSync(real, opts.config);
  const c = check(opts);
  assert.equal(c.linked_to, fs.realpathSync(real));
  assert.match(c.link_note, /is a link/);
  const r = install(opts);
  assert.equal(r.ok, true);
  assert.equal(r.linked_to, fs.realpathSync(real));
  assert.match(r.link_note, /file it points to/);
  assert.equal(fs.lstatSync(opts.config).isSymbolicLink(), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(real, 'utf8')).mcpServers, { other: { command: 'x' }, [NAME]: { command: opts.node, args: [opts.copy] } });
  assert.equal(modeOf(real), 0o600);
  assert.equal(fs.readFileSync(r.backup, 'utf8'), original);
  assert.equal(check(opts).current, true);
});

test('a link to a file that is not there: refuses, names the fix, changes nothing', () => {
  const { home, opts } = setup();
  fs.symlinkSync(path.join(home, 'missing.json'), opts.config);
  const r = install(opts);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'config_link_broken');
  assert.match(r.message, /nothing was changed.*Fix or remove that link/);
  assert.equal(fs.lstatSync(opts.config).isSymbolicLink(), true);
  assert.equal(fs.existsSync(opts.copy), false);
  assert.equal(backups(opts).length, 0);
});

test('node path: a Homebrew Cellar node uses the stable link when it runs the same binary', () => {
  const root = tmp('wavex-install-node-');
  const cellarNode = path.join(root, 'Cellar', 'node@22', '22.1.0', 'bin', 'node');
  fs.mkdirSync(path.dirname(cellarNode), { recursive: true });
  fs.writeFileSync(cellarNode, '');
  const shim = path.join(root, 'bin', 'node');
  fs.mkdirSync(path.dirname(shim));
  fs.symlinkSync(cellarNode, shim);
  const other = path.join(root, 'other', 'node');
  fs.mkdirSync(path.dirname(other));
  fs.writeFileSync(other, '');
  assert.deepEqual(pickNode({ execPath: cellarNode, shims: [other, shim] }), { node: shim, node_note: null });
  const noShim = pickNode({ execPath: cellarNode, shims: [other, path.join(root, 'none', 'node')] });
  assert.equal(noShim.node, cellarNode);
  assert.match(noShim.node_note, /upgrade or remove that Node\.js, type \/wavex-shop again/);
  assert.deepEqual(pickNode({ execPath: shim, shims: [shim] }), { node: shim, node_note: null });
  const nvm = pickNode({ execPath: '/home/x/.nvm/versions/node/v22.1.0/bin/node', shims: [shim] });
  assert.equal(nvm.node, '/home/x/.nvm/versions/node/v22.1.0/bin/node');
  assert.match(nvm.node_note, /type \/wavex-shop again/);
  const { opts } = setup();
  assert.equal(check({ ...opts, node_note: noShim.node_note }).node_note, noShim.node_note);
});

test('command line: check answers JSON and changes nothing', { skip: process.platform !== 'darwin' }, () => {
  const home = tmp('wavex-install-cli-');
  const r = spawnSync(process.execPath, [path.join(HERE, 'install.mjs'), 'check'], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
  const out = JSON.parse(r.stdout);
  assert.equal(r.status, 2);
  assert.equal(out.reason, 'no_desktop_app');
  assert.deepEqual(fs.readdirSync(home), []);
  const bad = spawnSync(process.execPath, [path.join(HERE, 'install.mjs'), 'nope'], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
  assert.equal(bad.status, 1);
});
