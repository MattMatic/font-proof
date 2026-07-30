/**
 * main.mjs — wiring only. Each concern lives in its own module.
 */

import { FontSlot, attachDropTarget, guardWindowDrops } from './fontSlot.mjs';
import { render as renderContent } from './content.mjs';
import { buildControls, applyState, applyAxes, defaults } from './controls.mjs';
import { analyse, highlight, codePointLabel } from './coverage.mjs';
import { sizeForTarget, ascentPx, looksUnconventional } from './metrics.mjs';

const DEFAULT_TEXT = `Hamburgefonstiv — AVATAR Wave Toy Yjar
Waltz, bad nymph, for quick jigs vex. 0123456789
fi fl ffi ffl st ct — “quotes”, ‘apostrophes’, en–dash, em—dash
Ärger Œuvre çedilla ñandú Ångström fjörður İstanbul
1/2 3/4 №42 £9.99 $8.50 €7,25 ¥600 ≈ ±0.5 × 10⁻³
THE QUICK BROWN FOX jumps over the lazy dog.`;

const state = defaults();
const stage = document.getElementById('stage');
const sourceEl = document.getElementById('source');
const controlsEl = document.getElementById('controls');
const axesEl = document.getElementById('axes');
const coverageEl = document.getElementById('coverage');
const noteEl = document.getElementById('sanitizeNote');

let format = 'text';

/* ------------------------------------------------------------------ slots */

const slots = ['A', 'B'].map((id) => {
  const pane = stage.querySelector(`.pane[data-slot="${id}"]`);
  const slot = new FontSlot(id);
  const entry = {
    id,
    slot,
    pane,
    proof: pane.querySelector('[data-field="proof"]'),
    nameEl: pane.querySelector('[data-field="name"]'),
    metaEl: pane.querySelector('[data-field="meta"]'),
    fileInput: pane.querySelector('[data-field="file"]'),
    axisValues: {}
  };

  const accept = async (file) => {
    entry.nameEl.textContent = `Loading ${file.name}…`;
    entry.metaEl.textContent = '';
    entry.metaEl.classList.remove('is-warn');
    try {
      const result = await slot.load(file);
      if (!result) return;                       // superseded
      describe(entry, file, result.meta);
      entry.axisValues = seedAxes(result.meta);
      buildAxisPanel();
      flagSharedNames();
      paint();
    } catch (err) {
      entry.nameEl.textContent = file.name;
      entry.metaEl.textContent = err.message;
      entry.metaEl.classList.add('is-warn');
      console.error(err);
    }
  };

  attachDropTarget(pane, accept);
  entry.fileInput.addEventListener('change', () => {
    if (entry.fileInput.files[0]) accept(entry.fileInput.files[0]);
    entry.fileInput.value = '';
  });

  return entry;
});

guardWindowDrops();

function describe(entry, file, meta) {
  const names = meta?.names || {};
  entry.nameEl.textContent = names.fullName || names.family || file.name;
  const bits = [];
  if (names.version) bits.push(names.version.replace(/^Version\s*/i, 'v'));
  if (meta?.flavour) bits.push(meta.flavour === 'CFF' ? 'CFF outlines' : 'TrueType outlines');
  if (meta?.axes) bits.push(`${Object.keys(meta.axes).length} axes`);
  if (meta?.compressed) bits.push('compressed container — metadata unread');
  bits.push(`${Math.round(file.size / 1024)} kB`);

  // Stored, not written directly: paint() runs on every keystroke and every
  // control change, and both the shared-name note and the size-match note
  // below need to be recomputed each time rather than appended on top of
  // whatever was there before.
  entry.baseMeta = bits.join(' · ');
  entry.metaEl.textContent = entry.baseMeta;
}

/** Rebuild the slot-header line from its parts. Safe to call every paint(). */
function refreshMeta(entry, extraNotes = []) {
  entry.metaEl.classList.remove('is-warn');
  const parts = [entry.baseMeta, entry.sharedNameNote, ...extraNotes].filter(Boolean);
  entry.metaEl.textContent = parts.join(' · ');
}

/**
 * The CSS family registered for each slot is always unique (see fontSlot.mjs
 * — Proof_A_n / Proof_B_n), so identical internal names never cause one
 * font to silently render as the other. This is purely an FYI for the
 * person testing: if both files report the same family/fullName, it's easy
 * to mistake "two builds of one typeface" for "I dropped the same file
 * twice", so surface it rather than let the header text alone imply that.
 */
function flagSharedNames() {
  const [a, b] = slots;
  for (const entry of slots) { entry.metaEl.title = ''; entry.sharedNameNote = ''; }

  const nameOf = (e) => e.slot.meta?.names?.fullName || e.slot.meta?.names?.family || null;
  const nameA = nameOf(a);
  const nameB = nameOf(b);

  if (nameA && nameB && nameA === nameB) {
    a.sharedNameNote = b.sharedNameNote = `shares internal name "${nameA}" with the other slot — rendering independently`;
    a.metaEl.title = b.metaEl.title =
      'Same font name table entry in both files. Each is still registered under its own generated CSS family and rendered independently.';
  }
}

function seedAxes(meta) {
  const values = {};
  for (const [tag, axis] of Object.entries(meta?.axes || {})) values[tag] = axis.default;
  return values;
}

/* --------------------------------------------------------------- controls */

buildControls(controlsEl, state, () => paint());

document.getElementById('resetSettings').addEventListener('click', () => {
  Object.assign(state, defaults());
  buildControls(controlsEl, state, () => paint());
  paint();
});

function buildAxisPanel() {
  axesEl.textContent = '';
  const withAxes = slots.filter((e) => e.slot.meta?.axes);
  if (!withAxes.length) return;

  const h = document.createElement('h3');
  h.textContent = 'Variation axes';
  axesEl.appendChild(h);

  for (const entry of withAxes) {
    const src = document.createElement('p');
    src.className = 'axis-src';
    src.textContent = `Slot ${entry.id}`;
    axesEl.appendChild(src);

    for (const axis of Object.values(entry.slot.meta.axes)) {
      const row = document.createElement('div');
      row.className = 'ctl';

      const label = document.createElement('label');
      label.textContent = axis.tag + (axis.hidden ? ' (hidden)' : '');
      row.appendChild(label);

      const input = document.createElement('input');
      input.type = 'range';
      input.min = axis.min; input.max = axis.max;
      input.step = (axis.max - axis.min) / 200;
      input.value = entry.axisValues[axis.tag] ?? axis.default;
      row.appendChild(input);

      const out = document.createElement('output');
      out.textContent = round(input.value);
      row.appendChild(out);

      input.addEventListener('input', () => {
        entry.axisValues[axis.tag] = Number(input.value);
        out.textContent = round(input.value);
        applyAxes(entry.proof, entry.axisValues);
      });

      axesEl.appendChild(row);
    }
  }
}

const round = (v) => String(Math.round(Number(v) * 100) / 100);

/* ---------------------------------------------------------------- layout */

const layoutButtons = document.querySelectorAll('.seg-btn[data-layout]');
for (const btn of layoutButtons) {
  btn.addEventListener('click', () => {
    layoutButtons.forEach((b) => b.classList.toggle('is-on', b === btn));
    stage.dataset.layout = btn.dataset.layout;
    paint();
  });
}

const formatButtons = document.querySelectorAll('.seg-btn[data-format]');
for (const btn of formatButtons) {
  btn.addEventListener('click', () => {
    formatButtons.forEach((b) => b.classList.toggle('is-on', b === btn));
    format = btn.dataset.format;
    paint();
  });
}

for (const btn of document.querySelectorAll('[data-close]')) {
  btn.addEventListener('click', () => { document.getElementById(btn.dataset.close).hidden = true; });
}

toggle('toggleSource', 'sourceDrawer');
toggle('toggleSettings', 'settingsDrawer');

function toggle(buttonId, drawerId) {
  const drawer = document.getElementById(drawerId);
  document.getElementById(buttonId).addEventListener('click', () => {
    drawer.hidden = !drawer.hidden;
    if (!drawer.hidden) drawer.querySelector('textarea, input, select, button')?.focus();
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('.drawer').forEach((d) => { d.hidden = true; });
});

/* ----------------------------------------------------------- sync scroll */

const syncBox = document.getElementById('syncScroll');
let syncing = false;

for (const entry of slots) {
  entry.proof.addEventListener('scroll', () => {
    if (!syncBox.checked || syncing) return;
    syncing = true;
    const other = slots.find((s) => s !== entry);
    const ratio = entry.proof.scrollTop /
      Math.max(1, entry.proof.scrollHeight - entry.proof.clientHeight);
    other.proof.scrollTop = ratio *
      Math.max(0, other.proof.scrollHeight - other.proof.clientHeight);
    other.proof.scrollLeft = entry.proof.scrollLeft;
    requestAnimationFrame(() => { syncing = false; });
  });
}

/* ------------------------------------------------------------- rendering */

sourceEl.value = DEFAULT_TEXT;
sourceEl.addEventListener('input', debounce(paint, 180));

function paint() {
  const { fragment, notes } = renderContent(sourceEl.value, format);
  noteEl.textContent = notes.join(' ') ||
    (format === 'html' ? 'HTML is filtered through an allow-list; font-related styles are stripped.'
                       : 'Switch to HTML or Markdown to proof structured text.');

  const overlay = stage.dataset.layout === 'overlay';
  const plain = sourceEl.value;
  coverageEl.textContent = '';

  const sizeMode = state.sizeMode || 'em';
  const targetPx = Number(state.size);

  // Pass 1 — resolve each slot's own font-size in px. In 'em' mode that's
  // just the literal Size value for both. In 'cap'/'x' mode, each slot gets
  // whatever font-size makes ITS cap-height / x-height equal targetPx, so
  // the two fonts land at the same rendered metric rather than the same em.
  const resolved = slots.map((entry) => ({
    entry,
    ...sizeForTarget(entry.slot.meta, sizeMode, targetPx, entry.slot.family)
  }));

  // Pass 2 — resolve baseline offsets. Shift every slot down by however much
  // less ascent it has than the tallest one, so the first line's baseline
  // lands at the same y in every pane. This is only ever additive (never
  // negative) so it can't clip content off the top of a pane.
  const withAscent = resolved.map((r) => ({ ...r, ascent: ascentPx(r.entry.slot.meta, r.fontSizePx) }));
  const knownAscents = withAscent.map((w) => w.ascent).filter((a) => a != null);
  const commonAscent = knownAscents.length === withAscent.length ? Math.max(...knownAscents) : null;

  // "Largest line spacing of the two fonts" = the current Line-height ratio
  // applied to each font's own resolved size (not its em) — so this tracks
  // whatever the Size/target control actually rendered, including when
  // cap-height or x-height matching has pushed the two fonts to different
  // font-sizes. Only body-text elements pick this up (see app.css); headings
  // keep scaling their own leading against their own font-size as usual.
  const ratio = Number(state.lineHeight) || 1;
  const sharedLeadingPx = state.baselineAlign
    ? Math.max(...withAscent.map((w) => ratio * w.fontSizePx))
    : null;

  for (const { entry, fontSizePx, source, ascent } of withAscent) {
    const overrides = overlay
      ? (entry.id === 'A'
          ? { ink: getVar('--slot-a') }
          : { ink: getVar('--slot-b'), paper: 'transparent' })
      : {};
    overrides.size = fontSizePx;

    applyState(entry.proof, state, overrides);
    applyAxes(entry.proof, entry.axisValues);
    entry.proof.style.setProperty(
      '--test-family',
      entry.slot.family ? `"${entry.slot.family}"` : 'sans-serif'
    );

    const auto = (state.baselineAlign && commonAscent != null && ascent != null)
      ? commonAscent - ascent
      : 0;
    const nudge = Number(entry.id === 'A' ? state.nudgeA : state.nudgeB) || 0;
    entry.proof.style.setProperty('--baseline-shift', `${Math.max(0, auto + nudge)}px`);

    entry.proof.classList.toggle('is-aligned', !!state.baselineAlign);
    if (sharedLeadingPx != null) entry.proof.style.setProperty('--shared-lh', `${sharedLeadingPx}px`);

    entry.proof.textContent = '';
    const wrap = document.createElement('div');
    wrap.className = 'baseline-wrap';
    wrap.appendChild(fragment.cloneNode(true));
    entry.proof.appendChild(wrap);

    reportSize(entry, sizeMode, fontSizePx, source, sharedLeadingPx);
    reportCoverage(entry, plain);
  }
}

function reportSize(entry, mode, fontSizePx, source, sharedLeadingPx) {
  if (!entry.slot.family) return; // nothing loaded — leave the placeholder text alone

  const notes = [];

  if (mode !== 'em') {
    const label = mode === 'cap' ? 'cap-height' : 'x-height';
    const sourceText = {
      table: 'from OS/2 table',
      measured: 'measured from glyph outline — no OS/2 v2+ data',
      assumed: 'assumed ratio — no data at all'
    }[source];
    notes.push(`${fontSizePx.toFixed(1)}px to match ${label} (${sourceText})`);

    if (looksUnconventional(entry.slot.meta)) {
      notes.push('unusually large vertical span — this ratio may not track visual size for stacking/diagonal scripts (e.g. Nastaliq)');
    }
  }

  if (sharedLeadingPx != null) {
    notes.push(`body line spacing locked to ${sharedLeadingPx.toFixed(1)}px (headings unaffected)`);
  }

  refreshMeta(entry, notes);
  if (notes.some((n) => n.startsWith('unusually'))) entry.metaEl.classList.add('is-warn');
}

function reportCoverage(entry, plain) {
  if (!entry.slot.family) return;

  const { missing, checked, agreesWithFontsCheck } = analyse(entry.slot.family, plain);
  highlight(entry.proof, missing);

  const block = document.createElement('div');
  const h = document.createElement('h3');
  h.textContent = `Coverage — slot ${entry.id}`;
  block.appendChild(h);

  const p = document.createElement('p');
  if (!missing.length) {
    p.className = 'ok';
    p.textContent = `All ${checked} distinct characters are supplied by this font.`;
  } else {
    p.textContent = `${missing.length} of ${checked} characters fall back to another font:`;
  }
  block.appendChild(p);

  if (missing.length) {
    const list = document.createElement('div');
    list.className = 'missing';
    for (const ch of missing) {
      const code = document.createElement('code');
      code.textContent = `${ch} ${codePointLabel(ch)}`;
      list.appendChild(code);
    }
    block.appendChild(list);
  }

  if (!agreesWithFontsCheck) {
    const warn = document.createElement('p');
    warn.textContent = 'Width probing and document.fonts.check() disagree here — treat the list as a hint.';
    block.appendChild(warn);
  }

  coverageEl.appendChild(block);
}

function getVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

document.fonts.ready.then(paint);
paint();
