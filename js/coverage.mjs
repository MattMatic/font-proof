/**
 * coverage.mjs — which characters in the proof text is the font NOT supplying?
 *
 * Without reading `cmap` there is no direct answer, so this measures instead:
 * the same character is measured with the test font backed by three very
 * different generic fallbacks. If the font covers the character, all three
 * measurements are identical because the fallback is never consulted. If they
 * disagree, something else drew the glyph.
 *
 * Known limits — read these before trusting the output:
 *   - False negatives when every fallback happens to have the same advance
 *     width for that character (common for U+00A0 and some CJK).
 *   - It measures advance width, not the glyph. A font mapping a character to
 *     .notdef with a real advance can read as "covered" while drawing tofu.
 *   - It works per code point, so a base + combining mark that the font
 *     supports individually but has no mark positioning for will look fine.
 *     Coverage is not the same as correct shaping.
 *   - document.fonts.check() is the standards-blessed alternative, but Blink,
 *     Gecko and WebKit disagree about whether it consults the cmap or only
 *     load state, so it is reported alongside rather than relied upon.
 */

const FALLBACKS = ['serif', 'monospace', 'cursive'];
const PROBE_SIZE = 100;

let ctx = null;
function context() {
  if (!ctx) ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: false });
  return ctx;
}

/**
 * @param {string} family  CSS family name of the loaded face
 * @param {string} text    the proof text
 * @returns {{ missing: string[], checked: number, agreesWithFontsCheck: boolean }}
 */
export function analyse(family, text) {
  if (!family) return { missing: [], checked: 0, agreesWithFontsCheck: true };

  const c = context();
  const points = new Set();

  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp < 0x21 || cp === 0x7f) continue;      // control and space-ish
    if (/\p{White_Space}/u.test(ch)) continue;
    points.add(ch);
  }

  const missing = [];
  let agrees = true;

  for (const ch of points) {
    const widths = FALLBACKS.map((fb) => {
      c.font = `${PROBE_SIZE}px "${family}", ${fb}`;
      return c.measureText(ch).width;
    });

    const spread = Math.max(...widths) - Math.min(...widths);
    const isMissing = spread > 0.05;
    if (isMissing) missing.push(ch);

    // Cross-check against the platform API where it is meaningful.
    try {
      const supported = document.fonts.check(`${PROBE_SIZE}px "${family}"`, ch);
      if (supported === isMissing) agrees = false;
    } catch { /* check() is allowed to throw on odd family names */ }
  }

  return { missing, checked: points.size, agreesWithFontsCheck: agrees };
}

/**
 * Wrap missing characters in the rendered proof so they are visible in place.
 * Returns the number of runs marked.
 */
export function highlight(root, missing) {
  if (!missing.length) return 0;
  const set = new Set(missing);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets = [];
  let node;
  while ((node = walker.nextNode())) {
    if ([...node.nodeValue].some((ch) => set.has(ch))) targets.push(node);
  }

  let count = 0;
  for (const text of targets) {
    const frag = document.createDocumentFragment();
    let buffer = '';
    const flush = () => { if (buffer) { frag.appendChild(document.createTextNode(buffer)); buffer = ''; } };

    for (const ch of text.nodeValue) {
      if (set.has(ch)) {
        flush();
        const span = document.createElement('span');
        span.className = 'tofu';
        span.title = `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')} not in this font`;
        span.textContent = ch;
        frag.appendChild(span);
        count++;
      } else {
        buffer += ch;
      }
    }
    flush();
    text.replaceWith(frag);
  }
  return count;
}

export function codePointLabel(ch) {
  return `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
}
