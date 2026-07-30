/**
 * sfntPeek.mjs — OPTIONAL. Delete this file and the app still works.
 *
 * This is not a font parser. It reads a handful of fixed-offset fields the
 * FontFace API refuses to expose and that a proofing tool genuinely needs:
 *
 *   1. `name` table records — so the header can show the font's own idea of its
 *      name and version rather than the filename you happened to save it under.
 *   2. `fvar` axis records — so variable fonts get real sliders with real
 *      ranges instead of a text box you have to type `"wght" 450` into.
 *   3. `head`, `hhea`, `OS/2` vertical metrics — so two fonts can be matched
 *      by cap-height or x-height instead of by em, and so baselines can be
 *      aligned across panes. See js/metrics.mjs for what these numbers are
 *      used for and, just as importantly, where they stop being reliable.
 *
 * Everything else in the file is ignored. Table directory layout per the
 * OpenType spec, "Font Files" and "name"/"fvar"/"head"/"hhea"/"OS/2" chapters.
 *
 * Limitations, stated plainly:
 *   - WOFF and WOFF2 are container formats. Their tables are compressed, so
 *      this returns null for them. FontFace still renders them fine.
 *   - TTC/OTC collections: only the first font in the collection is inspected.
 *   - No checksum validation. If the directory is lying, we report nonsense.
 *   - sxHeight/sCapHeight only exist in OS/2 version ≥ 2. Older fonts (and
 *      some Arabic/Nastaliq designs, where the concept doesn't map cleanly
 *      anyway) simply won't have them — metrics.mjs falls back to a measured
 *      glyph in that case, and says so.
 */

const NAME_IDS = {
  0: 'copyright',
  1: 'family',
  2: 'subfamily',
  3: 'uniqueId',
  4: 'fullName',
  5: 'version',
  6: 'postScriptName',
  8: 'manufacturer',
  9: 'designer',
  13: 'license',
  16: 'typographicFamily',
  17: 'typographicSubfamily',
  25: 'variationsPostScriptPrefix'
};

export function peek(buffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 12) throw new Error('File is too small to be a font.');

  const tag = readTag(view, 0);

  if (tag === 'wOFF' || tag === 'wOF2') {
    // Valid fonts, just not readable without inflating. Say so rather than
    // guessing.
    return { flavour: tag === 'wOFF' ? 'WOFF' : 'WOFF2', compressed: true, names: {}, axes: null };
  }

  let base = 0;
  let collection = 0;
  if (tag === 'ttcf') {
    collection = view.getUint32(8);
    base = view.getUint32(12);
  } else if (tag !== '\u0000\u0001\u0000\u0000' && tag !== 'true' && tag !== 'OTTO' && tag !== 'typ1') {
    throw new Error(`Unrecognised sfnt tag "${escapeTag(tag)}".`);
  }

  const flavour = readTag(view, base) === 'OTTO' ? 'CFF' : 'glyf';
  const numTables = view.getUint16(base + 4);
  const tables = new Map();

  for (let i = 0; i < numTables; i++) {
    const rec = base + 12 + i * 16;
    if (rec + 16 > buffer.byteLength) break;
    tables.set(readTag(view, rec), {
      offset: view.getUint32(rec + 8),
      length: view.getUint32(rec + 12)
    });
  }

  return {
    flavour,
    compressed: false,
    collectionCount: collection || undefined,
    tables: [...tables.keys()],
    names: tables.has('name') ? readNames(view, tables.get('name'), buffer.byteLength) : {},
    axes: tables.has('fvar') ? readAxes(view, tables.get('fvar'), buffer.byteLength) : null,
    metrics: readMetrics(view, tables, buffer.byteLength)
  };
}

/* --------------------------------------------------------------- metrics */

function readMetrics(view, tables, size) {
  const unitsPerEm = tables.has('head') ? readHead(view, tables.get('head'), size) : null;
  const hhea = tables.has('hhea') ? readHhea(view, tables.get('hhea'), size) : null;
  const os2 = tables.has('OS/2') ? readOS2(view, tables.get('OS/2'), size) : null;
  if (!unitsPerEm && !hhea && !os2) return null;
  return { unitsPerEm, hhea, os2 };
}

/** head.unitsPerEm — the size of the em square everything else scales by. */
function readHead(view, table, size) {
  const at = table.offset + 18;
  if (at + 2 > size) return null;
  const upm = view.getUint16(at);
  return upm || null;
}

/** hhea ascender/descender/lineGap — the metrics platforms fall back to. */
function readHhea(view, table, size) {
  const at = table.offset;
  if (at + 10 > size) return null;
  return {
    ascender: view.getInt16(at + 4),
    descender: view.getInt16(at + 6),
    lineGap: view.getInt16(at + 8)
  };
}

/**
 * OS/2 — vendor-declared typo metrics, win metrics, and (version ≥ 2) the
 * cap-height / x-height figures used for size matching. fsSelection bit 7 is
 * USE_TYPO_METRICS: when set, engines are meant to prefer sTypo* over hhea/win
 * for line layout. Not every engine honours this consistently, which is
 * exactly why this is treated as a strong hint rather than ground truth.
 */
function readOS2(view, table, size) {
  const at = table.offset;
  if (at + 78 > size) return null;

  const version = view.getUint16(at);
  const fsSelection = view.getUint16(at + 62);

  const out = {
    version,
    useTypoMetrics: (fsSelection & 0x80) !== 0,
    typoAscender: view.getInt16(at + 68),
    typoDescender: view.getInt16(at + 70),
    typoLineGap: view.getInt16(at + 72),
    winAscent: view.getUint16(at + 74),
    winDescent: view.getUint16(at + 76),
    sxHeight: null,
    capHeight: null
  };

  if (version >= 2 && at + 90 <= size) {
    out.sxHeight = view.getInt16(at + 86) || null;
    out.capHeight = view.getInt16(at + 88) || null;
  }

  return out;
}

/* ------------------------------------------------------------------ name */

function readNames(view, table, size) {
  const out = {};
  const start = table.offset;
  if (start + 6 > size) return out;

  const count = view.getUint16(start + 2);
  const stringBase = start + view.getUint16(start + 4);

  // Preference order: Windows Unicode BMP English, then any Windows Unicode,
  // then Mac Roman English. Later, better records overwrite earlier ones.
  const rank = (platformID, encodingID, languageID) => {
    if (platformID === 3 && encodingID === 1 && languageID === 0x0409) return 3;
    if (platformID === 3) return 2;
    if (platformID === 0) return 2;
    if (platformID === 1 && languageID === 0) return 1;
    return 0;
  };

  const best = {};

  for (let i = 0; i < count; i++) {
    const rec = start + 6 + i * 12;
    if (rec + 12 > size) break;

    const platformID = view.getUint16(rec);
    const encodingID = view.getUint16(rec + 2);
    const languageID = view.getUint16(rec + 4);
    const nameID = view.getUint16(rec + 6);
    const length = view.getUint16(rec + 8);
    const offset = view.getUint16(rec + 10);

    const key = NAME_IDS[nameID];
    if (!key) continue;

    const score = rank(platformID, encodingID, languageID);
    if (score === 0 || score <= (best[key] ?? 0)) continue;

    const at = stringBase + offset;
    if (at + length > size) continue;

    const bytes = new Uint8Array(view.buffer, at, length);
    const text = (platformID === 1)
      ? decodeMacRoman(bytes)
      : new TextDecoder('utf-16be').decode(bytes);

    if (!text.trim()) continue;
    out[key] = text.replace(/\u0000/g, '').trim();
    best[key] = score;
  }

  return out;
}

/* ------------------------------------------------------------------ fvar */

function readAxes(view, table, size) {
  const start = table.offset;
  if (start + 16 > size) return null;

  const axesOffset = start + view.getUint16(start + 4);
  const axisCount = view.getUint16(start + 8);
  const axisSize = view.getUint16(start + 10);
  if (!axisCount || axisSize < 20) return null;

  const axes = {};
  for (let i = 0; i < axisCount; i++) {
    const rec = axesOffset + i * axisSize;
    if (rec + 20 > size) break;
    const axisTag = readTag(view, rec);
    axes[axisTag] = {
      tag: axisTag,
      min: fixed(view, rec + 4),
      default: fixed(view, rec + 8),
      max: fixed(view, rec + 12),
      hidden: (view.getUint16(rec + 16) & 1) === 1
    };
  }
  return Object.keys(axes).length ? axes : null;
}

/* --------------------------------------------------------------- helpers */

function readTag(view, offset) {
  return String.fromCharCode(
    view.getUint8(offset), view.getUint8(offset + 1),
    view.getUint8(offset + 2), view.getUint8(offset + 3)
  );
}

function escapeTag(tag) {
  return [...tag].map((c) => (c < ' ' ? `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}` : c)).join('');
}

/** Fixed 16.16 → Number, as used by fvar axis values. */
function fixed(view, offset) {
  return view.getInt32(offset) / 65536;
}

// Enough of Mac Roman for the accented characters that show up in vendor and
// designer strings. Anything above the table falls back to the byte itself.
const MAC_ROMAN_HIGH =
  'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü' +
  '†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø' +
  '¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ' +
  '‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ';

function decodeMacRoman(bytes) {
  let s = '';
  for (const b of bytes) {
    s += b < 0x80 ? String.fromCharCode(b) : (MAC_ROMAN_HIGH[b - 0x80] ?? String.fromCharCode(b));
  }
  return s;
}
