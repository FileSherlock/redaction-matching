// build.mjs — Recto's build (<Recto>/tools/build.mjs) with this repository's
// plugin folder in place of Recto's copy: the page Recto would serve once the
// working copy here is synced in. Never writes into Recto.
//
// The plugin's suites import this file by the path they have in Recto
// (tests/plugins/redaction_matching/page.test.mjs → ../../../tools/build.mjs),
// so they run unchanged in both repositories. WEB is this repository's web/,
// where they read the plugin's own files; the rest of the page is Recto's.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { NAME, PLUGIN, RECTO, REPO } from './recto.mjs';

const recto = await import(pathToFileURL(path.join(RECTO, 'tools', 'build.mjs')).href);

export const WEB = path.join(REPO, 'web');

const hash8 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 8);
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : e.isFile() ? [path.join(dir, e.name)] : []);

export function build(options = {}) {
  const result = recto.build({ ...options, write: false, overlay: { [NAME]: PLUGIN, ...options.overlay } });
  // A Recto whose build predates overlays quietly builds its own copy instead:
  // make sure the page's plugin files are the ones here.
  if (result.plugins.some(p => p.name === NAME))
    for (const file of walk(PLUGIN)) {
      const rel = `plugins/${NAME}/${path.relative(PLUGIN, file).split(path.sep).join('/')}`;
      if (!rel.endsWith('/plugin.json') && result.assets[rel] !== hash8(file))
        throw new Error(`${RECTO} built its own copy of ${NAME}, not this one — its tools/build.mjs predates plugin overlays; update that checkout`);
    }
  return result;
}
