# CLAUDE.md

## What this is

Recto's `redaction_matching` plugin, developed on its own. It matches candidate names against
redaction bars by **measured width in the bar's own face**, labels each bar with the best
reading, and owns the *Name matching* right panel. Recto (the in-browser PDF editor at `../Recto`)
holds verbatim copies of this repository's three folders and never edits them — this
repository is the only place the plugin changes. The plugin runs only inside Recto, so every
tool here runs against the checkout at `../Recto` (or `RECTO=<path>`).

**The design doc is `guide/plugins/redaction-matching/README.md`** — read it before changing
what fits a bar, how readings rank, or the two-bar pairing.

## Commands

```bash
npm test                  # both suites (node:test) against this working copy — under a second
npm run serve             # Recto with this plugin → http://localhost:5051 (.claude/launch.json "recto")
npm run smoke             # Recto's headless-Chrome smoke test with this plugin — 1–2 min
npm run sync:recto:check  # what differs from Recto's copy; exit 1 if anything does
npm run sync:recto        # copy the three folders into ../Recto — only when asked
node tests/plugins/redaction_matching/matching.test.mjs   # the matcher suite alone
```

`npm run serve` is Recto's own server and build with this folder overlaid on Recto's copy
(`../Recto/tools/serve.mjs --plugin`): the page is exactly Recto's. Edit, reload.

## Layout — the same paths as in Recto

- `web/plugins/redaction_matching/` — the plugin. `plugin.json` (order 40; `api.js` is a
  `scripts_before_viewer` entry), `api.js` (all the logic, one classic script — Recto's
  page test holds the script list to its recording, so no second script),
  `styles.css` (scoped to the panel), `toolbar_button.html` (`#toggle-tools`),
  `sidebar_tools.html` (`#tools-sidebar`, the *Name matching* panel: the selected bar's
  fits, the name field, and collapsed Format / Filter / Names sections — api.js fills
  them), and the name lists, declared in `api.js`'s `NAME_LISTS`: `names.json` (People,
  ~180 KB of `{ first: [...], last: [...], prefix, nickname, suffix }`) and
  `contacts-businesses.json` (Businesses, `last`-only entries with a `note`; off by
  default). Grep them, never read them whole.
- `tests/plugins/redaction_matching/` — `matching.test.mjs` runs `api.js` under Node with the
  host's globals stubbed; `page.test.mjs` checks the generated page (imports
  `tools/build.mjs`, which here is Recto's build with this plugin overlaid).
- `guide/plugins/redaction-matching/README.md` — the design doc. Its links to `../README.md`
  and `../redaction-refiner/…` resolve in Recto (`../Recto/guide/plugins/`).
- `tools/` — `recto.mjs` (where Recto is), `build.mjs`, `serve.mjs`, `smoke.mjs`,
  `sync-recto.mjs`. Not synced.

## How it sits in Recto — read this instead of Recto

Script order in the page: core (`hooks.js` → `geometry.js` → `state.js` → `doc-service.js`) →
`scripts_before_viewer` (`webgl_mask`'s, then this `api.js`) → `pdf-viewer.js` →
`ui-events.js` → `app.js` → `scripts_after_app` (every other plugin, `text_tool` last). So at
load time `api.js` sees only the core and its own markup; everything from the other plugins
is resolved at call time, behind guards.

**From the core** (`../Recto/web/core/`): `state` / `els` (`state.js` — the plugin adds its own
fields to both at load; it reads `state.currentPage`, `els.viewerContainer`), `GEO`
(`geometry.js`: `docScale()`, `docPxPerPt()`, `docPtToPx(pt)`), `PDFHooks.on` and
`assetURL(path)` (`hooks.js`; the name lists are fetched through `assetURL`), `goToPage(n)`
(`pdf-viewer.js`).

**From `text_tool`** (`../Recto/web/plugins/text_tool/`), all guarded:
- `unified-text-box.js`: `utbState` (`boxes`, `selectedId`, `editingId`, `getBox(id)`,
  `addBox(box)`), `UnifiedTextBox`, `utbApplyCase` / `utbCaseMode` / `utbCaseValue` (letter
  case: `box.uppercase` is `false | true | 'first' | 'last'`), `utbFindNearestLine`,
  `normUtbFont`.
- `svg-renderer.js`: `renderBox(box)`, `selectBoxInSVG(id)`; bars are `.utb-group[data-id]`.
  `box.labelColor` and `box.labelAlign` are seams it honours when drawing the label.
- `toolbar.js`: `syncToolbarToBox(box)`, `getNaturalSpaceWidth({ fontFamily, sizePt, kerning })`.
- `shaping.js`: `Shaping.widths({ strings, family, bold, italic, size, scale, kerning,
  ligatures, space_width })` → `{ results: [{ width }] }` — HarfBuzz, image px. Never measure
  with the browser (`getBBox`).
- Controls it reads by id: `#tolerance`, `#tt-name-case` (Settings panel — its letter case
  applies on top of a bar's format), `#kerning`,
  `#fabric-font-family`, `#fabric-font-size` (formatting bar).

**Box fields.** Reads `type` (`'redaction'`; `'embedded'` spans give a line's
`baseCharPositions` `{ c, w }`), `page`, `x y w h` (image px, 96 DPI), `lineId`, `fontFamily`,
`sizePt` (PDF points), `bold`, `italic`, `kerning`, `uppercase`, `letterSpacing`,
`spaceWidth` / `defaultSpaceWidth`, `tolerance`, `refineInfo`. Writes `widths`, `widthFace`,
`verdicts`, `matchPick`, `nameSettings`, `candidates`, `text` / `labelText`, `labelColor`,
`labelAlign`, `spaceWidth` / `defaultSpaceWidth` / `nativeSpaceWidth`.

**Optional providers**, each absent → that feature no-ops:
- `ocr_tool` (`../Recto/web/plugins/ocr_tool/hypothesis-view.js`): `ocrTestHypothesis(box,
  name)` → `{ verdict: 'consistent' | 'contradicted' | 'no-evidence', … }` (page-pixel
  verdicts), `ocrMeasureWidths(box, strings)` → `{ widths, face }` (the page's own face).
- `redaction_refiner` (`../Recto/web/plugins/redaction_refiner/redaction-refiner.js`): writes
  `box.refineInfo` (`exact`, `x`, `w`, `left` / `right` with `kind`, `blocked`, `margin`),
  emits `redaction:refined` `{ boxId, remnants }`, reads `state.namesData` /
  `state.customCandidates`.

**Recto calls these by name** (guarded) — keep names and signatures, or change the caller in
Recto in the same piece of work:
- `text_tool/text-tool.js` → `createNewRedaction(page, x, y, w, h, lineId, lineFont,
  lineSizePt)` (the Add Box tool). Its own `window.handleManualAddBox` loads later and
  replaces the one in `api.js`.
- `text_tool/drag-resize.js` → `calculateWidthsForRedaction(id)`, `selectRedaction(id)`,
  `updateAllMatchesView(id)`, `renderCandidates()`, `syncNameSettingsUI()`;
  `text_tool/undo.js` → `updateAllMatchesView(id?)`.
- `calculateAllWidths()` ← `embedded_text_viewer/etv-fetch.js`, `ocr_tool/ocr-tool.js`,
  `redaction_refiner`.

When a seam's behaviour matters, read just that function in Recto (`grep -n` for it), not
the file.

## Rules

- Change the plugin here only; Recto's copies are synced, never edited there. Sync and
  commit only when asked; the sync refuses to overwrite a copy changed in Recto.
- `api.js` has no IIFE: its top-level `function`s are globals, some of them seams (above).
- Reach the host only behind guards (`typeof fn === 'function'`, `typeof Shaping !==
  'undefined'`, `?.` on DOM lookups): the page must work whatever else is installed.
- This is an optional plugin. Recto's core, its baseline plugins (`text_tool`,
  `embedded_text_viewer`, `webgl_mask`) and their docs never name it; a change that needs a
  new seam there is made in Recto, named for what it does.
- Geometry is image px at 96 DPI, type size is `sizePt` in points; convert with `GEO`, never
  with re-derived constants (`0.75`, `4/3`, `133`).
- Visibility goes through the `.hidden` class (the panel does); the paste area and the
  matches card still set `style.display`.
- Keep the design doc current with the code, in the same change. Recto's `guide/ui-map.md`
  lists baseline controls only; this plugin's UI is described in its own doc.
