/**
 * metrics.mjs — turn OpenType vertical metrics into comparable pixel values.
 *
 * Two different problems live here, and they need different fixes:
 *
 *   1. SIZE. "Same font-size" does not mean "same visual size" — x-height
 *      and cap-height are independent design choices, commonly 45%–65% of
 *      the em for x-height alone. sizeForTarget() lets both panes be driven
 *      to the same rendered cap-height or x-height instead of the same em.
 *
 *   2. BASELINE. Where the baseline sits inside a line box depends on which
 *      vertical-metrics table the engine consults — OS/2 typo metrics if
 *      fsSelection's USE_TYPO_METRICS bit is set, otherwise hhea, otherwise
 *      OS/2 win metrics — and engines are not fully consistent about this.
 *      ascentPx() estimates it from whichever table is present.
 *
 * Both are approximations built from numbers the font's author typed into a
 * table. That's true even in well-behaved Latin text faces. It becomes a much
 * looser approximation for scripts like Nastaliq, where composition is
 * diagonal and stacked rather than sitting on one shared horizontal line —
 * the ascender/descender there often describe a bounding box for that
 * stacking, not an optical baseline at all. looksUnconventional() is a crude
 * heuristic for flagging that case; it is not a script detector, and the
 * right response to it is the manual nudge, not more automation.
 */

const FALLBACK_RATIO = { cap: 0.72, x: 0.52 }; // last resort only, see below

/**
 * @param {object|null} meta      slot.meta from sfntPeek, or null
 * @param {'em'|'cap'|'x'} mode
 * @param {number} targetPx        literal font-size (mode 'em') or target
 *                                 rendered metric height in px (otherwise)
 * @param {string|null} family     CSS family, used only for the glyph-measure fallback
 */
export function sizeForTarget(meta, mode, targetPx, family) {
  if (mode === 'em' || !targetPx) return { fontSizePx: targetPx, source: 'em' };

  const m = meta?.metrics;
  const tableValue = mode === 'cap' ? m?.os2?.capHeight : m?.os2?.sxHeight;

  if (m?.unitsPerEm && tableValue) {
    return { fontSizePx: targetPx * m.unitsPerEm / tableValue, source: 'table' };
  }

  // No OS/2 v2+ figures (older font, or the table's simply absent). Measure
  // an actual glyph instead: cap-height from "H", x-height from "x". This is
  // a Latin-shaped stand-in and means nothing for e.g. Arabic — flagged as
  // 'measured' rather than presented as if it were authoritative.
  if (family) {
    const measured = measureGlyphRatio(family, mode === 'cap' ? 'H' : 'x');
    if (measured) return { fontSizePx: targetPx / measured, source: 'measured' };
  }

  return { fontSizePx: targetPx / FALLBACK_RATIO[mode], source: 'assumed' };
}

let probeCtx = null;
function measureGlyphRatio(family, ch) {
  probeCtx ??= document.createElement('canvas').getContext('2d');
  probeCtx.font = `1000px "${family}", sans-serif`;
  const m = probeCtx.measureText(ch);
  if (!m.actualBoundingBoxAscent) return null; // glyph absent or empty
  return m.actualBoundingBoxAscent / 1000;
}

/**
 * Ascent above the baseline, in px, at the given resolved font-size — using
 * whichever metrics table an engine most likely consults for line layout.
 * Returns null when there isn't enough of the font's metrics to say.
 */
export function ascentPx(meta, fontSizePx) {
  const m = meta?.metrics;
  if (!m?.unitsPerEm || !fontSizePx) return null;

  const preferTypo = m.os2?.useTypoMetrics && m.os2.typoAscender;
  const ascentUnits = preferTypo ? m.os2.typoAscender : (m.hhea?.ascender ?? m.os2?.winAscent);
  if (!ascentUnits) return null;

  return (ascentUnits * fontSizePx) / m.unitsPerEm;
}

/**
 * A rough signal that a font's declared vertical span is far outside the
 * Latin text-face norm (roughly 1.15–1.3× the em). Large stacked marks,
 * extreme swash designs, and Nastaliq-style composition all trip this. It is
 * a reason to distrust automatic alignment, not a diagnosis of what the font
 * actually is.
 */
export function looksUnconventional(meta) {
  const m = meta?.metrics;
  if (!m?.unitsPerEm || !m.hhea) return false;
  const span = (m.hhea.ascender ?? 0) - (m.hhea.descender ?? 0);
  return span > m.unitsPerEm * 1.6;
}
