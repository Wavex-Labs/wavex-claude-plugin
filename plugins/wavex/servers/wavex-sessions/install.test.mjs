import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { desktopConfigPath, check, install, NAME } from './install.mjs';

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
