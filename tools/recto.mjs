// recto.mjs — where the host is, and what this repository owns of it.
//
// The plugin runs only inside Recto, so every tool here works against a Recto
// checkout: ../Recto beside this repository (where tol0 expects it too), or
// the one RECTO=<path> or --recto <path> names. The three folders this
// repository owns sit at the same paths in both repositories, which is what
// lets the sync copy them verbatim and the suites run unchanged in either.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const NAME = 'redaction_matching';
export const PLUGIN = path.join(REPO, 'web', 'plugins', NAME);
export const FOLDERS = [`web/plugins/${NAME}`, `tests/plugins/${NAME}`, 'guide/plugins/redaction-matching'];

// The command line without --recto <path>, for the tools that pass theirs on.
const argv = process.argv.slice(2);
const at = argv.indexOf('--recto');
export const args = at < 0 ? argv : argv.filter((_, i) => i !== at && i !== at + 1);
export const RECTO = path.resolve(at >= 0 ? argv[at + 1] ?? '' : process.env.RECTO || path.join(REPO, '..', 'Recto'));

if (!fs.existsSync(path.join(RECTO, 'tools', 'build.mjs')) || !fs.existsSync(path.join(RECTO, 'web', 'core')))
  throw new Error(`no Recto checkout at ${RECTO} — clone it beside this repository, or point RECTO=<path> (or --recto <path>) at one`);
