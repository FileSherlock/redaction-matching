// matching.test.mjs — the matcher under Node with the viewer's globals
// stubbed: which names fit a bar (pixel tolerance vs the pen-exact lattice a
// refiner can vouch for), the loose fallback, how page-pixel verdicts from an
// optional hypothesis tester rank the list, two bars read as one name, the
// formats (their parts, optional groups and choices, and what the pill
// editor does to them) and the lists and filters the names come from. Run directly
// (`node tests/plugins/redaction_matching/matching.test.mjs`) or with the
// whole suite (`node --test "tests/**/*.test.mjs"`).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..', 'web', 'plugins', 'redaction_matching');   // the plugin's folder

// ── Viewer globals (api.js touches these at load) ──────────
globalThis.window = globalThis;
globalThis.document = {
  getElementById: () => null,          // no panel: every render bails out
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  fonts: { ready: Promise.resolve() },
};
globalThis.state = {};
globalThis.els = {};
globalThis.utbState = {
  boxes: [], selectedId: null, editingId: null,
  getBox(id) { return this.boxes.find((b) => b.id === id); },
};
globalThis.PDFHooks = { on() {}, emit() {} };
globalThis.GEO = { docScale: () => 100 * 96 / 72, docPxPerPt: () => 96 / 72, docPtToPx: (pt) => pt * 96 / 72 };
// The shaper (text_tool's Shaping.widths): a fixed width per string.
const HB = { Ada: 30.0, Bob: 40.0, 'Cy Dee': 50.0 };
globalThis.assetURL = (p) => p;
globalThis.Shaping = { widths: async (body) => ({ results: body.strings.map((s) => ({ width: HB[s] ?? 0 })) }) };
globalThis.fetch = async () => ({ ok: false, status: 404 });

vm.runInThisContext(fs.readFileSync(path.join(root, 'api.js'), 'utf8'));
for (const fn of ['getBoxMatchInfo', 'getBoxMatches', 'effectiveTolerance', 'scoreMatches', 'shownMatch', 'matchesLetterFilter',
                  'linkFor', 'halfStrings', 'setBoxMatch', 'cycleBoxMatch', 'fitRange', 'parseNamePattern', 'nameFromPattern',
                  'namesOfPattern', 'patternOfNameTree', 'makeNames', 'setNameList', 'calculateWidthsForRedaction']) {
  assert.equal(typeof globalThis[fn], 'function', `${fn} is a global`);
}

const person = (first, last, extra = {}) => ({
  first: [first].flat().filter(Boolean), last: [last].flat().filter(Boolean),
  prefix: null, nickname: null, suffix: null, ...extra,
});
// Fill the lists with no bar on the page, so nothing is measured behind a test's back.
function useNames(people, yours = []) {
  utbState.boxes = [];
  state.hiddenEntries.clear();
  state.customCandidates = [...yours];
  setNameList('people', people);
  setNameList('yours');
}

// A bar whose measured width is 120.5 px, with a candidate pool measured by
// the shaper: two names tie to the font unit, one is 0.8 px off, one is far.
const WIDTHS = { 'Sarah Kellen': 120.4375, 'Justin Nelson': 120.4453, 'Nicki Haskell': 121.32, 'Woody Allen': 117.0 };
const WIDTH_PEOPLE = Object.keys(WIDTHS).map(n => person(...n.split(' ')));
let n = 0;
const bar = (over = {}) => ({
  id: `r${++n}`, type: 'redaction', page: 1, x: 319.5, w: 120.5, y: 0, h: 20, tolerance: 3,
  widths: { ...WIDTHS }, ...over,
});
const exactInfo = (box) => ({ exact: true, source: 'ocr', x: box.x, w: box.w, left: {}, right: {}, remnants: [] });

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('pixel tolerance: everything within the field, closest first', () => {
  useNames(WIDTH_PEOPLE);
  const box = bar();
  box.refineInfo = { ...exactInfo(box), exact: false, source: 'embedded', left: { kind: 'word' }, right: { kind: 'word' } };
  const info = getBoxMatchInfo(box);
  assert.deepEqual(info.matches, ['Justin Nelson', 'Sarah Kellen', 'Nicki Haskell']);
  assert.equal(info.tol, 3);
  assert.equal(info.loose, false);
  assert.equal(effectiveTolerance(bar({ tolerance: undefined })), 3, 'default field');
  // With no refiner every edge is the detector's: a name up to the redactor's
  // padding narrower than the bar fits too (Woody Allen, 3.5 px under).
  assert.deepEqual(getBoxMatches(bar()), ['Justin Nelson', 'Sarah Kellen', 'Nicki Haskell', 'Woody Allen']);
});

test('pen-exact bar: the lattice decides, the 0.8 px name is out', () => {
  const box = bar();
  box.refineInfo = exactInfo(box);
  const info = getBoxMatchInfo(box);
  assert.deepEqual(info.matches, ['Justin Nelson', 'Sarah Kellen']);
  assert.equal(info.tol, 0.3);
  assert.equal(info.loose, false);
});

test('a tighter user field still wins over the lattice', () => {
  const box = bar({ tolerance: 0.055 });
  box.refineInfo = exactInfo(box);
  assert.deepEqual(getBoxMatches(box), ['Justin Nelson']);
  assert.equal(effectiveTolerance(box), 0.055);
});

test('a bar moved after refinement is no longer exact', () => {
  const box = bar();
  box.refineInfo = exactInfo(box);
  box.x += 1;
  assert.equal(effectiveTolerance(box), 3);
  assert.equal(getBoxMatches(box).length, 3);
});

test('embedded-derived edges are not exact', () => {
  const box = bar();
  box.refineInfo = { ...exactInfo(box), exact: false, source: 'embedded' };
  assert.equal(effectiveTolerance(box), 3);
});

test('nothing fits the exact width → nearest names within the field, flagged loose', () => {
  const box = bar({ w: 122.0 });
  box.refineInfo = exactInfo(box);
  const info = getBoxMatchInfo(box);
  assert.equal(info.loose, true);
  assert.equal(info.tol, 3);
  assert.deepEqual(info.matches, ['Nicki Haskell', 'Justin Nelson', 'Sarah Kellen']);
});

test('without a hypothesis tester, verdicts stay empty and order is by width', async () => {
  const box = bar();
  await scoreMatches(box);
  assert.equal(box.verdicts, null);
  assert.equal(getBoxMatches(box)[0], 'Justin Nelson');
});

test('page-pixel verdicts rank the list: consistent, no-evidence, contradicted', async () => {
  const box = bar();
  box.refineInfo = exactInfo(box);
  const calls = [];
  globalThis.ocrTestHypothesis = async (b, name) => {
    calls.push(name);
    if (name === 'Sarah Kellen') return { verdict: 'consistent', open: { ink: 40, match: 40, differ: 0 }, unexplained: 0 };
    if (name === 'Justin Nelson') return { verdict: 'contradicted', open: { ink: 40, match: 12, differ: 28 }, unexplained: 3 };
    return null;
  };
  await scoreMatches(box);
  assert.deepEqual(calls.sort(), ['Justin Nelson', 'Nicki Haskell', 'Sarah Kellen'], 'the fits and the near misses are tested, not the far ones');
  assert.deepEqual(getBoxMatches(box), ['Sarah Kellen', 'Justin Nelson'], 'a near miss without a consistent verdict stays out');
  assert.equal(shownMatch(box, getBoxMatches(box)).name, 'Sarah Kellen');
  // The user's own pick still wins while it fits.
  box.matchPick = 'Justin Nelson';
  assert.equal(shownMatch(box, getBoxMatches(box)).name, 'Justin Nelson');
  // A provider that throws is a null verdict, not a broken list.
  globalThis.ocrTestHypothesis = async () => { throw new Error('boom'); };
  await scoreMatches(box);
  assert.deepEqual(box.verdicts, { 'Justin Nelson': null, 'Nicki Haskell': null, 'Sarah Kellen': null });
  assert.equal(getBoxMatches(box).length, 2);
  delete globalThis.ocrTestHypothesis;
});

test('a near miss the page vouches for joins a pen-exact list', async () => {
  const box = bar();
  box.refineInfo = exactInfo(box);
  globalThis.ocrTestHypothesis = async (b, name) => ({ verdict: name === 'Nicki Haskell' ? 'consistent' : name === 'Justin Nelson' ? 'contradicted' : 'no-evidence' });
  await scoreMatches(box);
  const { entries, near, loose } = getBoxMatchInfo(box);
  assert.deepEqual(entries.map(e => e.name), ['Nicki Haskell', 'Sarah Kellen', 'Justin Nelson']);
  assert.equal(entries[0].near, true);
  assert.equal(loose, false);
  assert.deepEqual(near.map(e => e.name), ['Nicki Haskell']);
  // Between two consistent names the pen-exact one leads.
  globalThis.ocrTestHypothesis = async () => ({ verdict: 'consistent' });
  await scoreMatches(box);
  assert.deepEqual(getBoxMatches(box), ['Justin Nelson', 'Sarah Kellen', 'Nicki Haskell']);
  delete globalThis.ocrTestHypothesis;
});

test('a detector edge admits names narrower than the bar by the redactor\'s padding', () => {
  // "[Bledsoe] [is a]": the right edge is the black box's, 4.4 px past the name.
  useNames([person(null, 'Bledsoe'), person(null, 'Wide'), person(null, 'Far')]);
  const box = bar({ w: 55.84, widths: { Bledsoe: 51.4, Wide: 59.5, Far: 48.0 } });
  box.refineInfo = { ...exactInfo(box), exact: false, left: { kind: 'punct' }, right: null };
  const r = fitRange(box);
  assert.equal(r.over, 3);
  assert.ok(Math.abs(r.under - 0.4 * 16) < 1e-9, `under = 0.4 em: ${r.under}`);
  assert.equal(fitRange({ ...box, sizePt: 72 }).under, 10, 'the padding is capped — a 72 pt bar does not get 38 px');
  assert.deepEqual(getBoxMatches(box), ['Bledsoe']);
  // With reader pens on both sides the range is the tolerance both ways.
  box.refineInfo.right = { kind: 'word' };
  assert.deepEqual(fitRange(box), { over: 3, under: 3 });
  assert.deepEqual(getBoxMatches(box), []);
  // No refiner at all: every edge is the detector's.
  delete box.refineInfo;
  assert.deepEqual(getBoxMatches(box), ['Bledsoe']);
});

test('widths come from the page\'s own face when a reader offers them, else from HarfBuzz', async () => {
  useNames([person(null, 'Ada'), person(null, 'Bob'), person('Cy', 'Dee')]);
  const mk = () => {
    const box = bar({ widths: {} });
    utbState.boxes = [box];
    return box;
  };
  let box = mk();
  await calculateWidthsForRedaction(box.id);
  assert.deepEqual(box.widths, { Ada: 30.0, Bob: 40.0, 'Cy Dee': 50.0 }, 'HarfBuzz alone');
  assert.equal(box.widthFace, null);
  // A reader's set measures the row's face: it wins where it can draw the
  // string; a string with a glyph the set lacks keeps the HarfBuzz width.
  const asked = [];
  globalThis.ocrMeasureWidths = async (b, strings) => { asked.push(strings); return { widths: strings.map(s => s === 'Bob' ? null : HB[s] + 0.5), face: 'calibri102' }; };
  box = mk();
  await calculateWidthsForRedaction(box.id);
  assert.deepEqual(asked, [['Ada', 'Bob', 'Cy Dee']]);
  assert.deepEqual(box.widths, { Ada: 30.5, Bob: 40.0, 'Cy Dee': 50.5 });
  assert.equal(box.widthFace, 'calibri102');
  // No reader row → null → HarfBuzz stands. A throwing provider too.
  globalThis.ocrMeasureWidths = async () => null;
  box = mk();
  await calculateWidthsForRedaction(box.id);
  assert.deepEqual(box.widths, { Ada: 30.0, Bob: 40.0, 'Cy Dee': 50.0 });
  globalThis.ocrMeasureWidths = async () => { throw new Error('boom'); };
  box = mk();
  await calculateWidthsForRedaction(box.id);
  assert.equal(box.widths.Ada, 30.0);
  delete globalThis.ocrMeasureWidths;
  utbState.boxes = [];
});

// ── Two bars, one name ─────────────────────────────────────
// Bars carry a refiner's verdict (refineInfo): what stood on each side and
// whether a sibling bar bounded the search there. Widths are set directly,
// as a measurement would leave them.
const PERSONS = [
  person(['Nadia', 'Nada'], 'Marcinkova'),
  person('Sarah', 'Kellen'),
  person('Gregory', 'Bledsoe', { prefix: 'Dr.' }),
];
const info = (over) => ({ source: 'ocr', left: null, right: null, blocked: { left: false, right: false }, remnants: [], exact: false, ...over });
const word = (token) => ({ kind: 'word', token });
const firstOnly = { first: false, last: false };
function pairFixture(kind = 'row') {
  useNames(PERSONS);
  // "[Nadia] [Marcinkova]" a space apart, or "[Nadia]" ending a row and
  // "[Marcinkova]" opening the next.
  const A = bar({ id: 'A', x: 100, w: 40, y: 0, h: 20, widths: { Nadia: 40.1, Sarah: 36.0, Gregory: 52.0, Marcinkova: 76.2 } });
  const B = bar({ id: 'B', widths: { Marcinkova: 76.2, Kellen: 45.0, Bledsoe: 50.0, Nadia: 40.1 } });
  if (kind === 'row') {
    Object.assign(B, { x: 144, w: 76, y: 0, h: 20 });
    A.refineInfo = info({ left: word(','), right: null, blocked: { left: false, right: true } });
    B.refineInfo = info({ left: null, right: word(','), blocked: { left: true, right: false } });
  } else {
    Object.assign(B, { x: 120, w: 76, y: 21, h: 20 });
    A.refineInfo = info({ left: word(','), right: null });
    B.refineInfo = info({ left: null, right: word(',') });
  }
  A.refineInfo.x = A.x; A.refineInfo.w = A.w;
  B.refineInfo.x = B.x; B.refineInfo.w = B.w;
  // The fixture's halves are first[0] / last[0]; the aliases test turns them on.
  A.nameSettings = { ...defaultNameSettings(), aliases: { ...firstOnly } };
  B.nameSettings = { ...defaultNameSettings(), aliases: { ...firstOnly } };
  utbState.boxes.push(A, B);
  return { A, B };
}
const pairKeys = (box) => getBoxMatchInfo(box).entries.filter(e => e.kind === 'pair').map(e => e.key);

test('two bars a space apart are one person: first name on the left bar, last name on the right', () => {
  const { A, B } = pairFixture('row');
  assert.deepEqual(linkFor(A) && { other: linkFor(A).other.id, role: linkFor(A).role, kind: linkFor(A).kind }, { other: 'B', role: 'first', kind: 'row' });
  assert.deepEqual(linkFor(B) && { other: linkFor(B).other.id, role: linkFor(B).role, kind: linkFor(B).kind }, { other: 'A', role: 'last', kind: 'row' });
  // Nadia fits A and Marcinkova fits B — the same person. Sarah fits A too
  // (36.0 vs 40, within 3 px) but no Kellen fits B, and Bledsoe fits B but no
  // Gregory fits A: those never become readings.
  assert.deepEqual(pairKeys(A), ['pair:Nadia|Marcinkova']);
  assert.deepEqual(pairKeys(B), ['pair:Nadia|Marcinkova']);
  const a = getBoxMatchInfo(A).entries[0], b = getBoxMatchInfo(B).entries[0];
  assert.equal(a.name, 'Nadia'); assert.equal(a.partnerName, 'Marcinkova'); assert.equal(a.full, 'Nadia Marcinkova');
  assert.equal(b.name, 'Marcinkova'); assert.equal(b.partnerName, 'Nadia');
  assert.deepEqual(getBoxMatches(A), ['Nadia']);
  assert.deepEqual(getBoxMatches(B), ['Marcinkova']);
  // A single reading that fits B alone ranks after the pair: the pair
  // explains both bars with one person.
  const keep = utbState.boxes; utbState.boxes = [];
  setNameList('people', [...PERSONS, person('Clare', 'Hazell')]);
  utbState.boxes = keep;
  B.widths['Clare Hazell'] = 76.22;
  assert.deepEqual(getBoxMatches(B), ['Marcinkova', 'Clare Hazell']);
  assert.equal(getBoxMatchInfo(B).entries[0].kind, 'pair');
  // The bar's own strings to measure: its half of every person.
  assert.deepEqual(halfStrings(A, linkFor(A)).sort(), ['Clare', 'Gregory', 'Nadia', 'Sarah']);
  assert.deepEqual(halfStrings(B, linkFor(B)).sort(), ['Bledsoe', 'Hazell', 'Kellen', 'Marcinkova']);
});

test('a word between two bars keeps them apart; so does a wide gap', () => {
  const { A, B } = pairFixture('row');
  A.refineInfo.right = word('and');
  assert.equal(linkFor(A), null);
  assert.equal(linkFor(B), null, 'B sees no partner either — A has a word on its side');
  const f = pairFixture('row');
  f.B.x = 100 + 40 + 20;             // 20 px apart at 12 pt — more than a space
  assert.equal(linkFor(f.A), null);
});

test('a name split over a line break: last bar of one row, first bar of the next', () => {
  const { A, B } = pairFixture('line');
  assert.equal(linkFor(A).kind, 'line'); assert.equal(linkFor(A).role, 'first'); assert.equal(linkFor(A).other.id, 'B');
  assert.equal(linkFor(B).kind, 'line'); assert.equal(linkFor(B).role, 'last');
  assert.deepEqual(pairKeys(A), ['pair:Nadia|Marcinkova']);
  assert.equal(getBoxMatchInfo(B).entries[0].name, 'Marcinkova');
  // Not the next row → not linked; a word before B → not linked.
  B.y = 60; assert.equal(linkFor(A), null); B.y = 21;
  B.refineInfo.left = word('the'); assert.equal(linkFor(A), null);
});

test('settings shape the halves: spellings, letter filters, a title, typed names', () => {
  const { A, B } = pairFixture('row');
  A.widths.Nada = 40.0;
  A.nameSettings.aliases.first = true;
  assert.deepEqual(pairKeys(A).sort(), ['pair:Nada|Marcinkova', 'pair:Nadia|Marcinkova']);
  A.nameSettings.aliases.first = false;
  A.nameSettings.startsWith = 'S';   // a remnant on A says the first name starts with S
  assert.deepEqual(pairKeys(A), [], 'Nadia is filtered out; Sarah fits A but Kellen does not fit B');
  A.nameSettings.startsWith = '';
  A.nameSettings.formats = [{ id: 'f1', pattern: '{Title} {First} {Last}', on: true }];
  B.nameSettings.formats = [{ id: 'f1', pattern: '{Title} {First} {Last}', on: true }];
  A.widths['Dr. Gregory'] = 40.0; B.widths.Bledsoe = 76.0;
  assert.deepEqual(pairKeys(A), ['pair:Dr. Gregory|Bledsoe'], 'a title goes with the first half, and only people with one');
  A.nameSettings.formats = [{ id: 'f1', pattern: '{First} {Last}', on: true }];
  B.nameSettings.formats = [{ id: 'f1', pattern: '{First} {Last}', on: true }];
  const keep = utbState.boxes; utbState.boxes = [];
  addCustomNames(['Lex Wexner']);
  utbState.boxes = keep;
  A.widths.Lex = 40.2; B.widths.Wexner = 76.3;
  assert.ok(pairKeys(B).includes('pair:Lex|Wexner'), 'a typed name splits at its last space');
});

test('the halves follow the format: order and case; a comma between the names makes none', () => {
  const { A, B } = pairFixture('row');
  for (const box of [A, B]) box.nameSettings.formats = [{ id: 'f1', pattern: '{LAST} {First}', on: true }];
  A.widths.MARCINKOVA = 40.0; B.widths.Nadia = 76.0;
  assert.deepEqual(pairKeys(A), ['pair:MARCINKOVA|Nadia'], 'the last name in capitals on the first bar');
  assert.deepEqual(halfStrings(A, linkFor(A)).sort(), ['BLEDSOE', 'KELLEN', 'MARCINKOVA']);
  for (const box of [A, B]) box.nameSettings.formats = [{ id: 'f1', pattern: '{Last}, {First}', on: true }];
  assert.deepEqual(pairKeys(A), [], 'the comma would stand on the page between the bars');
  for (const box of [A, B]) box.nameSettings.formats = [{ id: 'f1', pattern: '{First}', on: true }];
  assert.deepEqual(pairKeys(A), [], 'a pair is a whole name');
});

test('picking a pair reading labels both bars; the partner follows a pair pick', () => {
  const { A, B } = pairFixture('row');
  A.widths.Sarah = 40.0; B.widths.Kellen = 76.1;      // a second person fits both bars
  assert.deepEqual(pairKeys(A).sort(), ['pair:Nadia|Marcinkova', 'pair:Sarah|Kellen']);
  setBoxMatch('B', 'pair:Sarah|Kellen');
  assert.equal(B.matchPick, 'pair:Sarah|Kellen');
  assert.equal(A.matchPick, 'pair:Sarah|Kellen', 'one person, both halves');
  assert.equal(shownMatch(A, getBoxMatchInfo(A).entries).name, 'Sarah');
  assert.equal(shownMatch(B, getBoxMatchInfo(B).entries).name, 'Kellen');
  assert.equal(A.labelText, 'Sarah', 'both bars are labelled');
  // Unpinning one bar unpins the pair.
  setBoxMatch('A', null);
  assert.equal(A.matchPick, null); assert.equal(B.matchPick, null);
  // A pick on one bar alone (no pick on the other) still couples them.
  B.matchPick = 'pair:Nadia|Marcinkova';
  assert.equal(shownMatch(A, getBoxMatchInfo(A).entries).name, 'Nadia');
  // Cycling steps through the readings by key.
  A.matchPick = null; B.matchPick = null;
  const first = shownMatch(A, getBoxMatchInfo(A).entries).name;
  cycleBoxMatch(1, 'A');
  assert.notEqual(shownMatch(A, getBoxMatchInfo(A).entries).name, first);
  assert.equal(A.matchPick, B.matchPick);
});

test('a pair is judged on both bars: contradicted anywhere is contradicted', async () => {
  const { A, B } = pairFixture('row');
  A.widths.Sarah = 40.0; B.widths.Kellen = 76.1;
  const tested = [];
  globalThis.ocrTestHypothesis = async (box, name) => {
    tested.push(`${box.id}:${name}`);
    if (box.id === 'A') return { verdict: 'consistent' };
    return { verdict: name === 'Kellen' ? 'contradicted' : 'consistent' };
  };
  await scoreMatches(A);
  await scoreMatches(B);
  assert.deepEqual(tested.sort(), ['A:Nadia', 'A:Sarah', 'B:Kellen', 'B:Marcinkova'], 'each half on its own bar, never the summed name');
  const entries = getBoxMatchInfo(A).entries;
  assert.deepEqual(entries.map(e => e.key), ['pair:Nadia|Marcinkova', 'pair:Sarah|Kellen'], 'the contradicted pair ranks last');
  assert.equal(getBoxMatchInfo(B).entries[0].name, 'Marcinkova');
  delete globalThis.ocrTestHypothesis;
});

test('without a refiner verdict no bar is linked', () => {
  const { A, B } = pairFixture('row');
  delete A.refineInfo;
  assert.equal(linkFor(A), null);
  assert.equal(linkFor(B), null);
  assert.deepEqual(getBoxMatchInfo(B).entries, []);
});

// ── Formats and lists ──────────────────────────────────────

// One spelling of an entry, as nameSpellings makes them.
const spelling = (v) => ({ first: null, middle: null, last: null, prefix: null, suffix: null, nickname: null, email: null, gender: null, ...v });
// What a pattern writes for one spelling: its variants' names, ' / ' between them.
const write = (pattern, v) => namesOfPattern(parseNamePattern(pattern), spelling(v)).join(' / ') || null;
const sarah = { first: 'Sarah', last: 'Kellen' };
const jeffrey = { first: 'Jeffrey', middle: 'E', last: 'Epstein' };

test('a format writes each part as its token is written; a missing name drops out with its separator', () => {
  assert.equal(write('{First} {Last}', sarah), 'Sarah Kellen');
  assert.equal(write('{LAST}, {First}', sarah), 'KELLEN, Sarah');
  assert.equal(write('{F}. {Last}', sarah), 'S. Kellen');
  assert.equal(write('{first}.{last}', sarah), 'sarah.kellen');
  assert.equal(write('{f}{last}', sarah), 'skellen');
  // one name of two (a business, a mononym): the same under every format, never a lone initial
  const club = { last: 'Aspen Club' };
  assert.equal(write('{First} {Last}', club), 'Aspen Club');
  assert.equal(write('{LAST}, {First}', club), 'ASPEN CLUB');
  assert.equal(write('{Last}, {F}.', club), 'Aspen Club');
  assert.equal(write('{First}', club), null);
  assert.equal(write('{F}. {Last}', { first: 'Abby' }), null);
  // a title, suffix or nickname is only written for an entry that has one
  assert.equal(write('{Title} {Last}', sarah), null);
  assert.equal(write('{Title} {Last}', { ...sarah, prefix: 'Ms.' }), 'Ms. Kellen');
  assert.match(parseNamePattern('{First} {Muddle}').error, /Muddle/);
  assert.ok(parseNamePattern('Kellen').error, 'a pattern needs a part');
  assert.equal(nameFormatLabel('{LAST}, {First}'), 'LAST, First');
});

test('the new parts: a middle name, an address and its halves, Mr or Ms by a recorded gender', () => {
  assert.equal(write('{First} {Middle} {Last}', { ...jeffrey, middle: 'Edward' }), 'Jeffrey Edward Epstein');
  assert.equal(write('{F}. {M}. {Last}', jeffrey), 'J. E. Epstein');
  assert.equal(write('{First} {M}. {Last}', sarah), null, 'no middle name, nothing written');
  const mail = { ...jeffrey, email: 'jeevacation@gmail.com' };
  assert.equal(write('{Email}', mail), 'jeevacation@gmail.com');
  assert.equal(write('{User}', mail), 'jeevacation');
  assert.equal(write('{first}.{last}@{Domain}', mail), 'jeffrey.epstein@gmail.com');
  assert.equal(write('{EMAIL}', mail), 'JEEVACATION@GMAIL.COM');
  assert.equal(write('{Email}', jeffrey), null);
  assert.equal(write('{Mr|Ms}. {Last}', { ...jeffrey, gender: 'm' }), 'Mr. Epstein');
  assert.equal(write('{Mr|Ms}. {Last}', { ...sarah, gender: 'f' }), 'Ms. Kellen');
  assert.equal(write('{Mr|Ms}. {Last}', sarah), null, 'no gender recorded, no Mr or Ms');
  assert.equal(write('{MRS} {LAST}', { ...sarah, gender: 'f' }), 'MRS KELLEN');
});

test('optional groups and choices spell one pattern out into several', () => {
  assert.equal(parseNamePattern('{First}[ {M}.] {Last}').variants.length, 2);
  assert.equal(write('{First}[ {M}.] {Last}', jeffrey), 'Jeffrey Epstein / Jeffrey E. Epstein');
  assert.equal(write('{First}[ {M}.] {Last}', sarah), 'Sarah Kellen', 'the variant without the middle name writes everyone else');
  assert.equal(write('[{Title} ]{First} {Last}', { ...sarah, prefix: 'Ms.' }), 'Sarah Kellen / Ms. Sarah Kellen');
  assert.equal(write('{First|Nick} {Last}', { ...sarah, nickname: 'Sissy' }), 'Sarah Kellen / Sissy Kellen');
  assert.equal(write('{First|F.} {Last}', sarah), 'Sarah Kellen / S. Kellen', 'a choice carries its own text');
  assert.equal(write('{F}[.] {Last}', sarah), 'S Kellen / S. Kellen', 'text alone can be optional');
  assert.equal(parseNamePattern('{First}[ {M}.[ ({Nick})]] {Last}').variants.length, 3, 'groups nest');
  assert.equal(parseNamePattern('{First|First} {Last}').variants.length, 1, 'the same variant twice is one');
  assert.equal(write('{Last} \\[{First}\\]', sarah), 'Kellen [Sarah]', 'a \\ writes a sign as it stands');
  for (const [pattern, error] of [
    ['{First} [{Last}', /\[/], ['{First}] {Last}', /\]/], ['{First {Last}', /\{/], ['{First} {Last}}', /\}/],
    ['{First|}', /no part/], ['{First}|{Last}', /\|/], ['{Frist} {Last}', /Frist/], ['{Last}\\', /\\/],
    ['{First|Nick|F}{Last|L}[a][b][c][d]', /96 variants/],
  ]) assert.match(parseNamePattern(pattern).error || '', error, pattern);
  assert.ok(parseNamePattern('{First|Nick|F}{Last|L}[a][b][c][d]').tree, 'too many variants is still a tree the pills can show');
});

test('the pills write a pattern back as it was', () => {
  for (const p of [...NAME_FORMAT_PRESETS, '{Last} \\[{First}\\]', '{First}[ {M}.[ ({Nick})]] {Last}', '{(Nick)|F.} {Last}']) {
    assert.equal(patternOfNameTree(parseNamePattern(p).tree), p);
  }
  assert.equal(patternOfNameTree(parseNamePattern('{ Last }').tree), '{Last}', 'spaces in braces are not kept');
});

test('what the pills do to a tree: optional, required, remove, move, add', () => {
  const edit = (pattern, fn) => {
    const tree = structuredClone(parseNamePattern(pattern).tree);
    const out = fn(tree);
    return [patternOfNameTree(tree), out];
  };
  // optional: a part with the text before it and the full stop clinging to it — first in its run, the text after it
  assert.deepEqual(edit('{First} {M}. {Last}', t => nameTreeWrap(t, [2])), ['{First}[ {M}.] {Last}', [1, 1]]);
  assert.deepEqual(edit('{Title} {First} {Last}', t => nameTreeWrap(t, [0])), ['[{Title} ]{First} {Last}', [0, 0]]);
  assert.deepEqual(edit('{First} {Last}, {Suffix}', t => nameTreeWrap(t, [4]))[0], '{First} {Last}[, {Suffix}]');
  assert.deepEqual(edit('{F}. {Last}', t => nameTreeWrap(t, [1]))[0], '{F}[. ]{Last}', 'text alone');
  assert.deepEqual(edit('{First}[ {M}.] {Last}', t => nameTreeUnwrap(t, [1]))[0], '{First} {M}. {Last}');
  // remove: a part goes with the text after it, or — last — the text before it; an emptied group goes
  assert.equal(edit('{First} {M}. {Last}', t => nameTreeRemove(t, [2]))[0], '{First} {Last}');
  assert.equal(edit('{Last}, {First}', t => nameTreeRemove(t, [2]))[0], '{Last}');
  assert.equal(edit('{Title} {First} {Last}', t => nameTreeRemove(t, [0]))[0], '{First} {Last}');
  assert.equal(edit('{First}[ {M}.] {Last}', t => nameTreeRemove(t, [1, 1]))[0], '{First} {Last}');
  // a part steps over text to the next part; text steps one place; a drag moves one node
  assert.deepEqual(edit('{Last}, {First}', t => nameTreeStep(t, [2], -1)), ['{First}, {Last}', [0]]);
  assert.deepEqual(edit('{First} {Last}', t => nameTreeStep(t, [1], 1)), ['{First}{Last} ', [2]]);
  assert.deepEqual(edit('{First} {Last}', t => nameTreeStep(t, [0], -1)), ['{First} {Last}', [0]], 'nowhere to go');
  assert.equal(edit('{First} {Last}', t => nameTreeMove(t, 2, 0))[0], '{Last}{First} ');
  // the palette: where a part usually goes, optional when only some entries have it
  assert.deepEqual(edit('{First} {Last}', t => nameTreeAdd(t, 'middleInitial')), ['{First}[ {M.}] {Last}', [1, 1]]);
  assert.equal(edit('{First} {Last}', t => nameTreeAdd(t, 'prefix'))[0], '[{Title} ]{First} {Last}');
  assert.equal(edit('{First} {Last}', t => nameTreeAdd(t, 'mr|ms'))[0], '[{Mr|Ms} ]{First} {Last}');
  assert.equal(edit('{First} {Last}', t => nameTreeAdd(t, 'suffix'))[0], '{First} {Last}[ {Suffix}]');
  assert.equal(edit('', t => nameTreeAdd(t, 'email'))[0], '{Email}', 'alone, nothing to be optional beside');
  assert.equal(edit('{First} {Last}', t => nameTreeAdd(t, 'last', 0))[0], '{Last} {First} {Last}', 'dropped where it was dropped');
  assert.deepEqual(edit('{First}', t => nameTreeAdd(t, 'text')), ['{First} ', [1]]);
  // a choice's word, and what "or" offers next
  assert.equal(nameAltOf('firstInitial', 'lower').word, 'f');
  assert.equal(nameAltOf('last', 'upper').word, 'LAST');
  assert.equal(nameAltKase(nameAltOf('firstInitial', 'upper')), 'as', 'a capital initial is as written');
  assert.equal(nameAltNext({ alts: [nameAltOf('first')] }), 'nickname');
  assert.equal(nameAltNext({ alts: [nameAltOf('mr'), nameAltOf('ms')] }), 'mrs');
});

test('the default format makes the same names from names.json as the old Full name did', () => {
  const people = JSON.parse(fs.readFileSync(path.join(root, 'names.json'), 'utf8'));
  useNames(people);
  const old = new Set();
  for (const p of people) {
    if (p.first.length && p.last.length) for (const f of p.first) for (const l of p.last) old.add(`${f} ${l}`);
    else for (const s of p.first.length ? p.first : p.last) old.add(s);
  }
  const made = new Set(makeNames(defaultNameSettings()).keys());
  assert.equal(made.size, old.size);
  assert.deepEqual([...made].filter(s => !old.has(s)), []);
});

test('lists: businesses are off until switched on; headings and plain strings; typed names; the hidden', () => {
  assert.equal(nameList('businesses').on, false);
  assert.equal(nameEntry({ first: [], last: ['BRAZIL'], note: 'section heading' }), null);
  assert.deepEqual(nameEntry('jeevacation@gmail.com'), { text: 'jeevacation@gmail.com' }, 'a plain string is written as it stands');
  assert.deepEqual(typedNameEntry('Ghislaine de Rothschild').last, ['Rothschild']);
  assert.deepEqual(typedNameEntry('Ghislaine').last, ['Ghislaine']);
  assert.equal(typedNameEntry('a@b.org').text, 'a@b.org');
  useNames([person('Sarah', 'Kellen'), 'x@y.org']);
  const s = { ...defaultNameSettings(), formats: [{ id: 'f1', pattern: '{LAST}, {First}', on: true }] };
  assert.deepEqual([...makeNames(s).keys()], ['KELLEN, Sarah', 'x@y.org']);
  state.hiddenEntries.add('people:0');
  assert.deepEqual([...makeNames(s).keys()], ['x@y.org']);
});

test('entries: a middle name, addresses and a gender are read; a spelling that writes the middle name is not given it again', () => {
  const e = nameEntry({ first: ['Jeffrey', 'Jeffrey E.'], middle: 'E', last: ['Epstein'], gender: 'M', email: 'jeevacation@gmail.com' });
  assert.deepEqual([e.middle, e.gender, e.email], [['E'], 'm', ['jeevacation@gmail.com']]);
  assert.deepEqual(['female', 'Woman', 'male', 'nonbinary', '', null].map(nameGender), ['f', 'f', 'm', 'x', null, null]);
  assert.ok(nameEntry({ first: [], last: [], email: ['a@b.org'] }), 'an address alone is an entry');
  useNames([person(['Jeffrey', 'Jeffrey E.'], 'Epstein', { middle: 'E' })]);
  const names = (...patterns) => [...makeNames({ ...defaultNameSettings(), formats: patterns.map((pattern, i) => ({ id: `f${i}`, pattern, on: true })) }).keys()].sort();
  assert.deepEqual(names('{First} {M}. {Last}'), ['Jeffrey E. Epstein'], 'not "Jeffrey E. E. Epstein"');
  assert.deepEqual(names('{First}[ {M}.] {Last}'), ['Jeffrey E. Epstein', 'Jeffrey Epstein']);
  assert.deepEqual(names('{F}. {M}. {Last}'), ['J. E. Epstein']);
});

test('the gender filter: women, men, and those with none recorded', () => {
  useNames([person('Sarah', 'Kellen', { gender: 'f' }), person('Jeffrey', 'Epstein', { gender: 'm' }), person('Lex', 'Wexner')], ['Ghislaine Maxwell']);
  const names = (gender) => [...makeNames({ ...defaultNameSettings(), gender }).keys()].sort();
  assert.deepEqual(names({ f: true, m: true, x: true }), ['Ghislaine Maxwell', 'Jeffrey Epstein', 'Lex Wexner', 'Sarah Kellen']);
  assert.deepEqual(names({ f: true, m: false, x: false }), ['Sarah Kellen']);
  assert.deepEqual(names({ f: false, m: true, x: true }), ['Ghislaine Maxwell', 'Jeffrey Epstein', 'Lex Wexner'], 'a typed name has no gender recorded');
  assert.equal(matchesGenderFilter({ text: 'a@b.org' }, { gender: { f: true, m: true, x: false } }), false);
  assert.deepEqual(completeNameSettings({ formats: [] }).gender, { f: true, m: true, x: true }, 'old settings let everyone through');
});

test('names.json: every person has the new fields, filled only where the list says', () => {
  const people = JSON.parse(fs.readFileSync(path.join(root, 'names.json'), 'utf8'));
  for (const p of people) assert.ok('middle' in p && 'gender' in p && Array.isArray(p.email), `${p.first[0]} ${p.last[0]}`);
  // a gender from a title that gives one (Mr, Lady, Prince …) on an entry of one person
  const MEN = /^(mr|sir|lord|prince|sultan|sheikh|senor|viscount|baron|earl|duke|marquess)\.?$/i;
  const WOMEN = /^(ms|mrs|miss|lady|princess|viscountess|duchess|baroness)\.?$/i;
  for (const p of people.filter(x => x.gender)) assert.ok((p.gender === 'm' ? MEN : WOMEN).test(p.prefix || ''), `${p.last[0]}: ${p.gender} beside ${p.prefix}`);
  assert.equal(people.find(p => p.last[0] === 'Bamford').gender, null, 'Sir Anthony and Carole Bamford are two people');
  // a middle initial where a spelling of the first name writes it
  for (const p of people.filter(x => x.middle)) assert.ok(p.first.includes(`${p.first[0]} ${p.middle}.`), `${p.first[0]} ${p.last[0]}`);
});

test('two bars: the halves of a middle initial, a choice of parts; a pair needs both bars\' gender filters', () => {
  const { A, B } = pairFixture('row');
  const keep = utbState.boxes; utbState.boxes = [];
  setNameList('people', [...PERSONS, person('Jeffrey', 'Epstein', { middle: 'E', gender: 'm', nickname: 'Jeff' })]);
  utbState.boxes = keep;
  for (const box of [A, B]) box.nameSettings.formats = [{ id: 'f1', pattern: '{First|Nick}[ {M}.] {Last}', on: true }];
  A.widths['Jeffrey E.'] = 40.0; A.widths.Jeff = 39.0; B.widths.Epstein = 76.0;
  // "Jeffrey E." (the middle initial goes with the first half) and "Jeff" (the nickname) fit A
  assert.deepEqual(pairKeys(A).sort(), ['pair:Jeffrey E.|Epstein', 'pair:Jeff|Epstein', 'pair:Nadia|Marcinkova']);
  A.nameSettings.gender = { f: true, m: false, x: true };
  assert.deepEqual(pairKeys(A), ['pair:Nadia|Marcinkova'], 'a man on one bar\'s filter is no pair, whatever the other bar lets through');
  const halves = p => nameVariantHalves(parseNamePattern(p).variants[0])?.map(h => nameFromPattern(h, spelling(sarah)));
  assert.deepEqual(halves('{F}. {Last}'), ['S.', 'Kellen'], 'an initial\'s full stop goes with it');
  assert.equal(halves('{Title}. {Last}'), undefined, 'a title is no name of its own');
});

test('each bar has its own settings, copied from the defaults; Apply to all bars copies one bar\'s', () => {
  useNames(WIDTH_PEOPLE);
  const A = bar({ id: 'pA' }), B = bar({ id: 'pB' });
  utbState.boxes.push(A, B);
  ensureBoxNameSettings(A).formats[0].pattern = '{LAST}, {First}';
  assert.equal(ensureBoxNameSettings(B).formats[0].pattern, '{First} {Last}', 'B keeps its own');
  assert.ok(getBoxCandidates(A).includes('KELLEN, Sarah'));
  utbState.selectedId = 'pA';
  applyNameFormatToAll();
  utbState.selectedId = null;
  assert.equal(B.nameSettings.formats[0].pattern, '{LAST}, {First}');
  assert.equal(state.nameSettings.formats[0].pattern, '{LAST}, {First}', 'and new bars');
  state.nameSettings = defaultNameSettings();
  utbState.boxes = [];
});

test('every spelling counts by default', () => {
  assert.deepEqual(defaultNameSettings().aliases, { first: true, last: true });
});

test('starts-with / ends-with filter takes several letters, case-insensitive', () => {
  assert.equal(matchesLetterFilter('Sarah Kellen', { startsWith: 'sa', endsWith: 'LLEN' }), true);
  assert.equal(matchesLetterFilter('Sarah Kellen', { startsWith: 'j' }), false);
  assert.equal(matchesLetterFilter('Sarah Kellen', {}), true);
  assert.equal(matchesLetterFilter('', { startsWith: 's' }), false);
});

let failed = 0;
for (const t of tests) {
  try {
    await t.fn();
    console.log(`  ok   ${t.name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${t.name}\n       ${e.message.split('\n').join('\n       ')}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
