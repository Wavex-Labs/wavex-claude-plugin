// PL3: the skill lint, and the bridge skill against its own lint.json.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lintSkill, findSkills, run } from './skill-lint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const BRIDGE = path.join(REPO, 'plugins', 'wavex', 'skills', 'wavex-bridge');

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
function makeSkill(name, skillText, rules) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wavex-lint-')); made.push(root);
  const dir = path.join(root, name);
  fs.mkdirSync(dir);
  if (skillText !== null) fs.writeFileSync(path.join(dir, 'SKILL.md'), skillText);
  if (rules !== null) fs.writeFileSync(path.join(dir, 'lint.json'), typeof rules === 'string' ? rules : JSON.stringify(rules));
  return dir;
}
const GOOD = '---\nname: demo\ndescription: "A demo skill."\n---\n\n# Demo\n\nNever call `submit_automation`.\nop=<op>\n';

test('the bridge skill passes its lint: the tag, the five operations, the three named tools and the refusal lines', () => {
  const r = lintSkill(BRIDGE);
  assert.deepEqual(r.failures, []);
  assert.ok(r.checks >= 60);
  const rules = JSON.parse(fs.readFileSync(path.join(BRIDGE, 'lint.json'), 'utf8'));
  const texts = rules.must.map(e => (typeof e === 'string' ? e : e.text)).join('\n');
  for (const needed of [
    '[wavex-bridge v=1 req=<id> op=<op>]',
    '`list_sessions`', '`session_digest`', '`draft_listing`', '`save_session`', '`run_steps`',
    'servers/wavex-sessions/server.mjs" --cli', '`ArtifactData`', '`ArtifactComments`',
    '`unsupported_op`', '`no_node`',
  ]) assert.ok(texts.includes(needed), `lint.json asks for ${needed}`);
});

test('run with no argument finds every skill that has a lint.json and exits 0', () => {
  assert.ok(findSkills(REPO).includes(BRIDGE));
  const r = spawnSync(process.execPath, [path.join(HERE, 'skill-lint.mjs')], { encoding: 'utf8', cwd: os.tmpdir() });
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /^ok {4}wavex-bridge: \d+ checks$/m);
});

test('a missing text fails with exit 1 and a line that names the skill, the list and the text', () => {
  const dir = makeSkill('demo', GOOD, { must: ['Never call `submit_automation`', { text: 'error row `no_node`', why: 'no Node' }], must_match: ['^name: demo$', 'op=<[a-z]+>', 'nothing like this \\d{9}'], must_not: ['op=<op>', 'never here'] });
  const r = run([dir]);
  assert.equal(r.code, 1);
  const out = r.lines.join('\n');
  assert.match(out, /FAIL {2}demo: 3 of 9 checks failed/);
  assert.match(out, /must: SKILL\.md is missing: "error row `no_node`" \(no Node\)/);
  assert.match(out, /must_match: SKILL\.md matches nothing for: "nothing like this \\\\d\{9\}"/);
  assert.match(out, /must_not: SKILL\.md holds text it must not hold: "op=<op>"/);
});

test('the top of the file is checked: the name must equal the folder name, and a description is needed', () => {
  const wrongName = lintSkill(makeSkill('demo', GOOD.replace('name: demo', 'name: other'), { must: [] }));
  assert.equal(wrongName.failures.length, 1);
  assert.match(wrongName.failures[0].why, /must equal the folder name/);
  const noFront = lintSkill(makeSkill('demo', '# Demo\n', { must: [] }));
  assert.equal(noFront.failures.length, 2);
});

test('a file that is missing or broken exits 2 and says which file to fix', () => {
  assert.match(run([makeSkill('demo', null, { must: [] })]).lines.join('\n'), /demo: SKILL\.md is missing/);
  assert.equal(run([makeSkill('demo', null, { must: [] })]).code, 2);
  assert.match(run([makeSkill('demo', GOOD, null)]).lines.join('\n'), /demo: lint\.json is missing\. Put it next to SKILL\.md\./);
  assert.match(run([makeSkill('demo', GOOD, '{ not json')]).lines.join('\n'), /demo: lint\.json is not valid JSON/);
  assert.match(run([makeSkill('demo', GOOD, { should: ['x'] })]).lines.join('\n'), /has a list named "should"\. Use must, must_match or must_not\./);
  assert.match(run([makeSkill('demo', GOOD, { must_match: ['('] })]).lines.join('\n'), /is not a valid regular expression/);
  assert.equal(run([makeSkill('demo', GOOD, { must: [{ why: 'no text' }] })]).code, 2);
});
