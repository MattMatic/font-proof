/**
 * controls.mjs — the rendering settings panel.
 *
 * Every setting maps to a CSS custom property on the proof surface, so the
 * panes stay declarative and there is exactly one place where a value can be
 * wrong. Nothing here touches the font bytes.
 *
 * Notes on the less obvious choices:
 *   - `font-synthesis: none` is the default. Otherwise the browser fakes bold
 *     and italic and you end up judging the browser's slant algorithm rather
 *     than the typeface.
 *   - `font-kerning` and `font-variant-ligatures` are exposed separately from
 *     `font-feature-settings`, because the low-level property overrides the
 *     high-level ones and the interaction surprises people.
 *   - `text-rendering` is a Gecko/Blink hint with no equivalent in Core Text or
 *     DirectWrite. It is here to explain differences, not to be trusted.
 */

export const SCHEMA = [
  { key: 'size',      css: '--fs',      label: 'Size / target', type: 'range', min: 8, max: 240, step: 1, value: 64, unit: 'px' },
  { key: 'lineHeight', css: '--lh',     label: 'Line height', type: 'range', min: 0.8, max: 3, step: 0.01, value: 1.4 },
  { key: 'tracking',  css: '--ls',      label: 'Tracking',    type: 'range', min: -0.1, max: 0.4, step: 0.001, value: 0, unit: 'em' },
  { key: 'wordSpace', css: '--ws',      label: 'Word space',  type: 'range', min: -0.2, max: 1, step: 0.01, value: 0, unit: 'em' },
  { key: 'weight',    css: '--fw',      label: 'Weight',      type: 'range', min: 1, max: 1000, step: 1, value: 400 },
  { key: 'measure',   css: '--pad',     label: 'Margin',      type: 'range', min: 0, max: 160, step: 4, value: 32, unit: 'px' },

  { key: 'style',     css: '--fst',     label: 'Style',   type: 'select', value: 'normal',
    options: [['normal', 'Normal'], ['italic', 'Italic'], ['oblique 10deg', 'Oblique 10°']] },

  { key: 'kerning',   css: '--kern',    label: 'Kerning', type: 'select', value: 'normal',
    options: [['normal', 'On (kern)'], ['none', 'Off'], ['auto', 'Auto (engine decides)']] },

  { key: 'ligatures', css: '--liga',    label: 'Ligatures', type: 'select', value: 'normal',
    options: [
      ['normal', 'Default (liga, clig)'],
      ['none', 'None'],
      ['common-ligatures discretionary-ligatures', '+ Discretionary'],
      ['common-ligatures historical-ligatures', '+ Historical'],
      ['no-common-ligatures contextual', 'Contextual only']
    ] },

  { key: 'optical',   css: '--optical', label: 'Optical size', type: 'select', value: 'auto',
    options: [['auto', 'Auto (opsz follows size)'], ['none', 'Off']] },

  { key: 'synthesis', css: '--synth',   label: 'Synthesis', type: 'select', value: 'none',
    options: [['none', 'None — show the real face'], ['weight style small-caps', 'Allow faux bold / italic']] },

  { key: 'rendering', css: '--trend',   label: 'text-rendering', type: 'select', value: 'auto',
    options: [['auto', 'auto'], ['optimizeLegibility', 'optimizeLegibility'], ['geometricPrecision', 'geometricPrecision'], ['optimizeSpeed', 'optimizeSpeed']] },

  { key: 'smoothing', css: '--smooth',  label: 'Smoothing', type: 'select', value: 'auto',
    options: [['auto', 'Platform default'], ['antialiased', 'Greyscale (-webkit)'], ['subpixel-antialiased', 'Subpixel (-webkit)']] },

  { key: 'align',     css: '--align',   label: 'Alignment', type: 'select', value: 'start',
    options: [['start', 'Start'], ['center', 'Centre'], ['end', 'End'], ['justify', 'Justify']] },

  { key: 'features',  css: '--feat',    label: 'Features', type: 'text', value: '', wide: true,
    placeholder: '"ss01" 1, "onum" 1, "cv02" 3' },

  { key: 'paper',     css: '--paper',   label: 'Paper', type: 'color', value: '#ffffff' },
  { key: 'ink',       css: '--fg',      label: 'Ink',   type: 'color', value: '#101010' }
];

// These don't map to a CSS custom property — main.mjs reads them directly
// each paint(), because matching size and aligning baselines both need to
// look at *both* slots at once, which a single-element style property can't.
export const RUNTIME = [
  { key: 'lang', label: 'lang', type: 'text', value: 'en', placeholder: 'ar, hi, ja, tr…', wide: true },
  { key: 'dir',  label: 'Direction', type: 'select', value: 'auto',
    options: [['auto', 'auto'], ['ltr', 'ltr'], ['rtl', 'rtl']] },

  { key: 'sizeMode', label: 'Size matches', type: 'select', value: 'em',
    options: [
      ['em', 'Em (literal size, no matching)'],
      ['cap', 'Cap-height'],
      ['x', 'x-height']
    ] },

  { key: 'baselineAlign', label: 'Align baselines', type: 'checkbox', value: false },
  { key: 'nudgeA', label: 'Nudge A', type: 'range', min: -80, max: 80, step: 1, value: 0, unit: 'px' },
  { key: 'nudgeB', label: 'Nudge B', type: 'range', min: -80, max: 80, step: 1, value: 0, unit: 'px' }
];

export function defaults() {
  const state = {};
  for (const c of [...SCHEMA, ...RUNTIME]) state[c.key] = c.value;
  return state;
}

/**
 * Render the panel. onChange(state) fires on every input.
 */
export function buildControls(container, state, onChange) {
  container.textContent = '';

  for (const c of [...SCHEMA, ...RUNTIME]) {
    const row = document.createElement('div');
    row.className = c.type === 'range' ? 'ctl' : 'ctl ctl-wide';
    if (c.wide) row.className = 'ctl ctl-wide';

    const label = document.createElement('label');
    label.textContent = c.label;
    label.htmlFor = `ctl-${c.key}`;
    row.appendChild(label);

    let input;
    if (c.type === 'select') {
      input = document.createElement('select');
      for (const [value, text] of c.options) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = text;
        input.appendChild(opt);
      }
    } else if (c.type === 'text') {
      input = document.createElement('input');
      input.type = 'text';
      input.placeholder = c.placeholder || '';
    } else if (c.type === 'color') {
      input = document.createElement('input');
      input.type = 'color';
    } else if (c.type === 'checkbox') {
      input = document.createElement('input');
      input.type = 'checkbox';
    } else {
      input = document.createElement('input');
      input.type = 'range';
      input.min = c.min; input.max = c.max; input.step = c.step;
    }

    input.id = `ctl-${c.key}`;
    if (c.type === 'checkbox') input.checked = !!state[c.key];
    else input.value = state[c.key];
    row.appendChild(input);

    let readout = null;
    if (c.type === 'range') {
      readout = document.createElement('output');
      readout.textContent = format(state[c.key], c.unit);
      row.appendChild(readout);
    }

    input.addEventListener('input', () => {
      state[c.key] = c.type === 'checkbox' ? input.checked : input.value;
      if (readout) readout.textContent = format(input.value, c.unit);
      onChange(state);
    });

    container.appendChild(row);
  }
}

function format(value, unit) {
  const n = Number(value);
  const text = Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return unit ? text + unit : text;
}

/**
 * Push state onto a proof element as custom properties.
 * `overrides` lets overlay mode force per-slot ink colours.
 */
export function applyState(el, state, overrides = {}) {
  for (const c of SCHEMA) {
    const raw = overrides[c.key] ?? state[c.key];
    el.style.setProperty(c.css, withUnit(c, raw));
  }
  el.lang = state.lang || '';
  el.dir = state.dir || 'auto';
}

function withUnit(c, raw) {
  if (c.key === 'features') return raw?.trim() ? raw : 'normal';
  if (!c.unit) return String(raw);
  return `${raw}${c.unit}`;
}

/**
 * Compose font-variation-settings from axis sliders. Variation settings are
 * applied per pane because the two fonts have different axes.
 */
export function applyAxes(el, axisValues) {
  const entries = Object.entries(axisValues || {});
  el.style.setProperty(
    '--vars',
    entries.length ? entries.map(([tag, v]) => `"${tag}" ${v}`).join(', ') : 'normal'
  );
}
