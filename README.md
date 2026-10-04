# redaction-matching

Recto's `redaction_matching` plugin — candidate names matched against redaction bars by their
measured width, in the bar's own face — developed on its own.

[Recto](https://github.com/FileSherlock/Recto) runs the plugin; this repository is where it is
written. Recto holds verbatim copies of the three folders below and never edits them: the
arrangement tol0's engine has, and for the same reason — Recto runs what was tested here. A
workspace this small is also a cheap one to hand an AI.

## Layout

The folders sit at the same paths as in Recto, so the suites and the docs work unchanged in
both repositories and the sync is a plain copy.

```
web/plugins/redaction_matching/     the plugin: plugin.json, api.js, styles.css, its two HTML
                                    fragments, the name lists (names.json,
                                    contacts-businesses.json)
tests/plugins/redaction_matching/   its suites (node:test)
guide/plugins/redaction-matching/   its docs — what fits a bar and why: start there
tools/                              the host and the sync
```

## Run

Needs Node 22 and a Recto checkout beside this one (`../Recto`; or `RECTO=<path>`, or
`--recto <path>` on any tool). There is nothing to install.

```bash
npm run serve             # Recto with this plugin → http://localhost:5051
npm test                  # the plugin's suites, against this working copy
npm run smoke             # Recto's browser smoke test with this plugin (Chrome + ../tol0's puppeteer-core)
npm run sync:recto:check  # what differs from Recto's copy; writes nothing, exit 1 if anything does
npm run sync:recto        # copy the three folders into Recto
```

`npm run serve` is Recto's own dev server and build (`tools/serve.mjs --plugin`) with this
repository's plugin folder in place of Recto's copy. The page, the toolbar, the viewer and
every other plugin are Recto's, so it looks exactly as it will once synced — and nothing is
written into Recto. Edit here, reload there.

## The cycle

1. Edit here; `npm test`; look at it with `npm run serve` (and `npm run smoke` when the
   change touches the page).
2. Commit here.
3. `npm run sync:recto`, then in Recto `node --test "tests/**/*.test.mjs"` and commit there.
   The sync prints which commit of this repository Recto now holds.

The sync will not overwrite a copy that was changed in Recto rather than synced from here — a
version this repository never had, and not the one this checkout synced last. It names the
files, shows how to compare them, and stops without writing anything; `--force` overwrites.

A change that needs Recto itself to change — a new seam in `text_tool`, a new event — is made
in Recto, generically: Recto's core and baseline plugins never name this plugin.

## Licence

GNU AGPL v3, as Recto — see [LICENSE](LICENSE).
