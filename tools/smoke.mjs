// smoke.mjs — Recto's browser smoke test (<Recto>/tests/smoke/smoke.mjs) with
// this repository's plugin in place of Recto's copy: every golden document
// uploaded through the real file input, every toolbar toggle clicked, and any
// console error, page error or failed request fails it. Needs Chrome and
// puppeteer-core (Recto borrows ../tol0/node_modules); a minute or two.
//
//   node tools/smoke.mjs [--only <golden name>] [--chrome <exe>] [--recto <path>]
//
// A plugin's own smoke steps (tests/plugins/<name>/smoke.mjs) are read from
// Recto's copy of that folder: one added here counts once it is synced.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from './build.mjs';
import { args, PLUGIN, RECTO } from './recto.mjs';

try { build(); } catch (e) { if (/predates/.test(e.message)) throw e; }

const smoke = path.join(RECTO, 'tests', 'smoke', 'smoke.mjs');
// Recto's smoke test reads its options from process.argv when it loads.
process.argv = [process.argv[0], smoke, ...args, '--plugin', PLUGIN];
await import(pathToFileURL(smoke).href);
