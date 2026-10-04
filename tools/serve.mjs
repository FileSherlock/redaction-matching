// serve.mjs — Recto's dev server with this repository's plugin in place of
// Recto's copy (<Recto>/tools/serve.mjs --plugin): the site's own page — the
// same toolbar, viewer, panels and other plugins — running this working
// copy's code. Edit here, reload there. Nothing is written into Recto.
//
//   node tools/serve.mjs [port] [--no-isolate] [--recto <path>]    default 5051 → http://localhost:5051
//
// 5051 so it can run beside Recto's own server (5000, or 5050 from its
// .claude/launch.json).

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from './build.mjs';
import { args, PLUGIN, RECTO } from './recto.mjs';

// A Recto that cannot overlay a plugin would serve its own copy without a
// word; stop here instead. Any other build error is the page's to show.
try { build(); } catch (e) { if (/predates/.test(e.message)) throw e; }

const port = args.find(a => /^\d+$/.test(a)) ?? '5051';
const server = path.join(RECTO, 'tools', 'serve.mjs');
// Recto's server reads its options from process.argv when it loads.
process.argv = [process.argv[0], server, port, '--plugin', PLUGIN, ...args.filter(a => a !== port)];
await import(pathToFileURL(server).href);
