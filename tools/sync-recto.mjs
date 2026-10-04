// sync-recto.mjs — push this plugin into Recto. This repository is the one
// place the plugin is developed; Recto holds verbatim copies of the folders
// below and never edits them — the direction tol0's engine sync has, for the
// same reason: what Recto runs is what was tested here.
//
//   node tools/sync-recto.mjs            sync into ../Recto (or RECTO=<path>, or --recto <path>)
//   node tools/sync-recto.mjs --check    report what differs, write nothing; exit 1 if anything does
//   node tools/sync-recto.mjs --force    also overwrite copies that were changed in Recto
//
// The folders, at the same path in both repositories:
//   web/plugins/redaction_matching/      the plugin
//   tests/plugins/redaction_matching/    its suites (Recto's node --test runs them too)
//   guide/plugins/redaction-matching/    its docs
// New and changed files are copied; a file Recto has there and this
// repository does not is removed. Dotfiles and editor backups (*~) are left out.
//
// THE GUARD. A sync overwrites Recto's copy, so it first checks that the copy
// came from here: a version this repository's git knows (committed or staged),
// or the one this checkout synced last (.recto-sync.json, local, not
// committed). Anything else was edited in Recto, and copying over it would
// throw that work away without a word — so the sync names those files and
// stops, having written nothing. Bring the edit over here, or --force.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { args, FOLDERS, RECTO, REPO } from './recto.mjs';

const check = args.includes('--check'), force = args.includes('--force');
for (const a of args)
  if (a !== '--check' && a !== '--force') { console.error(`unknown arg: ${a}`); process.exit(2); }

const STATE = path.join(REPO, '.recto-sync.json');
const sha = buf => createHash('sha256').update(buf).digest('hex');
const skip = name => name.startsWith('.') || name.endsWith('~');
const walk = (dir, root = dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []).flatMap(e => {
  if (skip(e.name)) return [];
  const full = path.join(dir, e.name);
  return e.isDirectory() ? walk(full, root) : e.isFile() ? [path.relative(root, full).split(path.sep).join('/')] : [];
});
const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

// What this checkout last left in this Recto: relative path → sha256.
let states = {};
try { states = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { /* never synced from this checkout */ }
const last = states[RECTO] || {};

// Does this repository's git hold that exact content (any commit, or staged)?
function gitKnows(buf) {
  const blob = createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
  try { git('cat-file', '-e', blob); return true; } catch { return false; }
}

const plan = [];   // { rel, op: 'new' | 'changed' | 'extra' | 'same', here, there }
for (const folder of FOLDERS) {
  const mine = walk(path.join(REPO, folder)), theirs = walk(path.join(RECTO, folder));
  for (const f of [...new Set([...mine, ...theirs])].sort()) {
    const rel = `${folder}/${f}`;
    const here = mine.includes(f) ? fs.readFileSync(path.join(REPO, rel)) : null;
    const there = theirs.includes(f) ? fs.readFileSync(path.join(RECTO, rel)) : null;
    plan.push({ rel, here, there, op: !there ? 'new' : !here ? 'extra' : here.equals(there) ? 'same' : 'changed' });
  }
}
const differ = plan.filter(p => p.op !== 'same');
// Recto's copies a sync would overwrite or remove that did not come from here.
const foreign = differ.filter(p => p.there && last[p.rel] !== sha(p.there) && !gitKnows(p.there));

const LABEL = check ? { new: 'STALE  ', changed: 'STALE  ', extra: 'EXTRA  ', same: 'same   ' }
                    : { new: 'new    ', changed: 'sync   ', extra: 'remove ', same: 'same   ' };
console.log(`Recto: ${RECTO}`);
for (const p of plan)
  console.log(`${LABEL[p.op]}${p.rel}${foreign.includes(p) ? `   ← ${p.here ? 'changed' : 'added'} in Recto, not synced from here` : ''}`);

if (check) {
  if (foreign.length) console.log(`\n${foreign.length} of Recto's copies were changed there — a sync stops on them (see the header)`);
  console.log(differ.length ? `\n${differ.length} file(s) differ — run: npm run sync:recto` : '\nRecto is in sync');
  process.exit(differ.length ? 1 : 0);
}

if (foreign.length && !force) {
  console.error(`\n${foreign.length} of Recto's copies were changed there, not synced from here. Look first:`);
  for (const p of foreign)
    console.error(p.here ? `  diff -u ${path.join(REPO, p.rel)} ${path.join(RECTO, p.rel)}` : `  cat ${path.join(RECTO, p.rel)}   (only Recto has it)`);
  console.error('Bring what is worth keeping into this repository, commit, and sync again — or pass --force to');
  console.error('overwrite them. Refusing to sync; nothing was written.');
  process.exit(2);
}

for (const p of differ) {
  const dst = path.join(RECTO, p.rel);
  if (p.op === 'extra') fs.rmSync(dst);
  else { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.writeFileSync(dst, p.here); }
}

// Recto's folders now hold exactly this repository's: remember them.
states[RECTO] = Object.fromEntries(plan.filter(p => p.here).map(p => [p.rel, sha(p.here)]));
fs.writeFileSync(STATE, JSON.stringify(states, null, 1) + '\n');

if (!differ.length) { console.log('\nnothing to do — Recto already in sync'); process.exit(0); }
// Which state of this repository Recto now holds, for the commit message there.
let from = '';
try {
  from = `redaction-matching ${git('rev-parse', '--short', 'HEAD')}`;
  if (git('status', '--porcelain', '--', ...FOLDERS)) from += ' + uncommitted changes';
} catch { /* not a git checkout yet, or no commit */ }
console.log(`\nsynced ${differ.length} file(s) into Recto${from ? ` — ${from}` : ''}`);
console.log('Next, in Recto: node --test "tests/**/*.test.mjs", then commit there.');
