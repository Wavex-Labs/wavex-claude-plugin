#!/usr/bin/env node
// skill-lint: checks that a skill still says what it must say.
//
// A skill folder may hold a lint.json next to its SKILL.md:
//   {
//     "must":       ["exact text the skill must hold", { "text": "...", "why": "what breaks without it" }],
//     "must_match": ["a regular expression the skill must match", { "pattern": "...", "flags": "m", "why": "..." }],
//     "must_not":   ["exact text the skill must never hold"]
//   }
// It also checks the top of SKILL.md: a name equal to the folder name, and a description.
//
//   node scripts/skill-lint.mjs                  every skill under plugins/*/skills that has a lint.json
//   node scripts/skill-lint.mjs <skill folder>   one or more skill folders
//
// Exit 0: every check passed. Exit 1: a check failed; each line names the skill, the list and the text.
// Exit 2: a file is missing or lint.json is not valid. It reads files only: no network, no writes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LISTS = ['must', 'must_match', 'must_not'];

export function findSkills(repo = REPO) {
  const out = [];
  const plugins = path.join(repo, 'plugins');
  if (!fs.existsSync(plugins)) return out;
  for (const p of fs.readdirSync(plugins).sort()) {
    const skills = path.join(plugins, p, 'skills');
    if (!fs.existsSync(skills)) continue;
    for (const s of fs.readdirSync(skills).sort()) {
      if (fs.existsSync(path.join(skills, s, 'lint.json'))) out.push(path.join(skills, s));
    }
  }
  return out;
}

// Returns { skill, checks, failures: [{ list, text, why }] }. Throws { code: 'unreadable' } when a file is missing or broken.
export function lintSkill(dir) {
  const unreadable = (message) => Object.assign(new Error(message), { code: 'unreadable' });
  const skill = path.basename(path.resolve(dir));
  const skillFile = path.join(dir, 'SKILL.md');
  const rulesFile = path.join(dir, 'lint.json');
  if (!fs.existsSync(skillFile)) throw unreadable(`${skill}: SKILL.md is missing. Put it in ${dir}.`);
  if (!fs.existsSync(rulesFile)) throw unreadable(`${skill}: lint.json is missing. Put it next to SKILL.md.`);
  const text = fs.readFileSync(skillFile, 'utf8');
  let rules;
  try { rules = JSON.parse(fs.readFileSync(rulesFile, 'utf8')); } catch (e) { throw unreadable(`${skill}: lint.json is not valid JSON (${e.message}). Fix the file.`); }
  for (const key of Object.keys(rules)) {
    if (!LISTS.includes(key) && key !== 'about') throw unreadable(`${skill}: lint.json has a list named "${key}". Use must, must_match or must_not.`);
  }
  for (const key of LISTS) {
    if (rules[key] !== undefined && !Array.isArray(rules[key])) throw unreadable(`${skill}: lint.json "${key}" must be a list.`);
  }

  const failures = [];
  let checks = 0;
  const fail = (list, shown, why) => failures.push({ list, text: shown, why: why || '' });

  // The top of the file: Claude Code reads the name and the description from it.
  const front = /^---\n([\s\S]*?)\n---\n/.exec(text);
  checks += 2;
  if (!front) {
    fail('frontmatter', 'the file must start with a --- block');
    fail('frontmatter', 'description');
  } else {
    const name = /^name:\s*(.+)$/m.exec(front[1])?.[1].trim().replace(/^["']|["']$/g, '');
    if (name !== skill) fail('frontmatter', `name: ${skill}`, `the name is ${name ? `"${name}"` : 'missing'}; it must equal the folder name`);
    if (!/^description:\s*\S/m.test(front[1])) fail('frontmatter', 'description', 'Claude Code picks the skill by its description');
  }

  const entry = (e, field) => (typeof e === 'string' ? { value: e } : { value: e?.[field], why: e?.why, flags: e?.flags });
  for (const e of rules.must || []) {
    const { value, why } = entry(e, 'text');
    if (typeof value !== 'string' || !value) throw unreadable(`${skill}: lint.json "must" holds an entry with no text.`);
    checks++;
    if (!text.includes(value)) fail('must', value, why);
  }
  for (const e of rules.must_match || []) {
    const { value, why, flags } = entry(e, 'pattern');
    if (typeof value !== 'string' || !value) throw unreadable(`${skill}: lint.json "must_match" holds an entry with no pattern.`);
    let re;
    try { re = new RegExp(value, flags || 'm'); } catch (err) { throw unreadable(`${skill}: lint.json "must_match" pattern ${JSON.stringify(value)} is not a valid regular expression (${err.message}).`); }
    checks++;
    if (!re.test(text)) fail('must_match', value, why);
  }
  for (const e of rules.must_not || []) {
    const { value, why } = entry(e, 'text');
    if (typeof value !== 'string' || !value) throw unreadable(`${skill}: lint.json "must_not" holds an entry with no text.`);
    checks++;
    if (text.includes(value)) fail('must_not', value, why);
  }
  return { skill, checks, failures };
}

export function run(args, repo = REPO) {
  const lines = [];
  const dirs = args.length ? args : findSkills(repo);
  if (!dirs.length) return { code: 2, lines: ['No skill with a lint.json was found under plugins/*/skills. Add a lint.json next to a SKILL.md.'] };
  let failed = 0;
  for (const dir of dirs) {
    let r;
    try { r = lintSkill(dir); } catch (e) {
      if (e.code !== 'unreadable') throw e;
      return { code: 2, lines: [...lines, e.message] };
    }
    if (!r.failures.length) { lines.push(`ok    ${r.skill}: ${r.checks} checks`); continue; }
    failed += r.failures.length;
    lines.push(`FAIL  ${r.skill}: ${r.failures.length} of ${r.checks} checks failed`);
    for (const f of r.failures) {
      const what = f.list === 'must_not' ? 'holds text it must not hold' : f.list === 'must_match' ? 'matches nothing for' : 'is missing';
      lines.push(`      ${f.list}: SKILL.md ${what}: ${JSON.stringify(f.text)}${f.why ? ` (${f.why})` : ''}`);
    }
  }
  return { code: failed ? 1 : 0, lines };
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const { code, lines } = run(process.argv.slice(2));
  process.stdout.write(lines.join('\n') + '\n');
  process.exitCode = code;
}
