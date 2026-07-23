/**
 * fontSlot.mjs — owns one comparison slot (A or B).
 *
 * Responsibilities:
 *   - accept a File (drop or picker)
 *   - build a FontFace from the raw bytes and register it on document.fonts
 *   - retire the previously registered face for this slot
 *   - report the family name to use in CSS, plus whatever metadata we could read
 *
 * Deliberately does NOT parse the font to render it. The only parsing is the
 * optional metadata peek in ./optional/sfntPeek.mjs, which the app runs in a
 * try/catch and can live without.
 */

const ACCEPTED = /\.(ttf|otf|ttc|otc|woff2?)$/i;

let serial = 0;

export class FontSlot extends EventTarget {
  /** @param {string} id  "A" or "B" */
  constructor(id) {
    super();
    this.id = id;
    this.family = null;      // CSS family name currently registered
    this.face = null;        // the live FontFace
    this.meta = null;        // { fullName, version, axes, ... } or null
    this.file = null;
    this.generation = 0;     // guards against out-of-order loads
  }

  get isLoaded() { return this.face !== null; }

  /**
   * Load a File into this slot. Resolves with { family, meta } or throws.
   */
  async load(file) {
    if (!file) throw new Error('No file given.');
    if (!ACCEPTED.test(file.name)) {
      throw new Error(`${file.name} is not a .ttf, .otf, .ttc, .woff or .woff2 file.`);
    }

    const gen = ++this.generation;
    const buffer = await file.arrayBuffer();

    // Peek at the name/fvar tables if the optional module is present.
    let meta = null;
    try {
      const { peek } = await import('./optional/sfntPeek.mjs');
      meta = peek(buffer);
    } catch (err) {
      // Metadata is a nicety; a failure here must not block rendering.
      console.info(`[slot ${this.id}] metadata unavailable:`, err.message);
    }

    // A fresh family name per load. Reusing a name that the engine may still be
    // holding in a layout pass produces stale or flickering text, and it also
    // defeats any attempt to load two different files that share a real name.
    const family = `Proof_${this.id}_${++serial}`;

    // Wide descriptor ranges so a variable font is driven by our controls
    // rather than being clamped to a single instance. For a static font this
    // is harmless: it just means the browser never looks for a sibling face.
    const face = new FontFace(family, buffer, {
      weight: meta?.axes?.wght
        ? `${meta.axes.wght.min} ${meta.axes.wght.max}`
        : '1 1000',
      stretch: meta?.axes?.wdth
        ? `${meta.axes.wdth.min}% ${meta.axes.wdth.max}%`
        : '50% 200%',
      // Always 'normal': slant is driven by the slnt/ital axis sliders, and an
      // oblique range here would fight font-style selection.
      style: 'normal',
      display: 'block'
    });

    let loaded;
    try {
      loaded = await face.load();
    } catch (err) {
      // Browsers run the bytes through a sanitiser (OTS in Blink/Gecko) before
      // accepting them. A font the OS renders happily can still be rejected.
      throw new Error(
        `The browser refused this font. It loaded as bytes but failed validation ` +
        `— usually a malformed table, a bad checksum, or an unsupported flavour. ` +
        `(${err.message || err.name})`
      );
    }

    if (gen !== this.generation) return null; // superseded by a later drop

    this.retire();
    document.fonts.add(loaded);

    this.family = family;
    this.face = loaded;
    this.meta = meta;
    this.file = file;

    this.dispatchEvent(new CustomEvent('loaded', { detail: { family, meta, file } }));
    return { family, meta };
  }

  /** Remove this slot's face from the document registry. */
  retire() {
    if (!this.face) return;
    document.fonts.delete(this.face);
    this.face = null;
    this.family = null;
  }
}

/**
 * Remove every registered face whose family matches, regardless of who added
 * it. Useful if a previous session left faces behind on a hot reload.
 */
export function deleteFontByName(family) {
  const doomed = [];
  document.fonts.forEach((f) => { if (f.family === family) doomed.push(f); });
  doomed.forEach((f) => document.fonts.delete(f));
  return doomed.length;
}

/**
 * Wire drag-and-drop for a pane element. Returns a teardown function.
 *
 * The dragover listener must call preventDefault or the browser navigates to
 * the dropped file instead of handing it to us. Counting enter/leave events
 * avoids the flicker you get when the pointer crosses a child element.
 */
export function attachDropTarget(el, onFile) {
  let depth = 0;

  const enter = (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (++depth === 1) el.classList.add('is-target');
  };
  const over = (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const leave = () => {
    if (--depth <= 0) { depth = 0; el.classList.remove('is-target'); }
  };
  const drop = (e) => {
    e.preventDefault();
    depth = 0;
    el.classList.remove('is-target');
    const file = e.dataTransfer?.files?.[0];
    if (file) onFile(file);
  };

  el.addEventListener('dragenter', enter);
  el.addEventListener('dragover', over);
  el.addEventListener('dragleave', leave);
  el.addEventListener('drop', drop);

  return () => {
    el.removeEventListener('dragenter', enter);
    el.removeEventListener('dragover', over);
    el.removeEventListener('dragleave', leave);
    el.removeEventListener('drop', drop);
  };
}

function hasFiles(e) {
  return Array.from(e.dataTransfer?.types || []).includes('Files');
}

/** Stop the window from navigating when a font is dropped outside a pane. */
export function guardWindowDrops() {
  const stop = (e) => { if (hasFiles(e)) e.preventDefault(); };
  window.addEventListener('dragover', stop);
  window.addEventListener('drop', stop);
}
