# Type Proof

Paste text, drop two fonts, compare. No build step, no dependencies.

```
python3 -m http.server 8000
# then open http://localhost:8000/
```

A server is required. ES modules are fetched with CORS rules that `file://`
fails, so opening `index.html` directly gives you a blank page and a console
full of module errors.

## Files

```
index.html
css/app.css
js/main.mjs              wiring
js/fontSlot.mjs          FontFace creation, registry hygiene, drag/drop
js/content.mjs           plain / Markdown / HTML → sanitised DOM
js/controls.mjs          settings schema → CSS custom properties
js/coverage.mjs          which characters fall back to another font
js/metrics.mjs           size-matching and baseline-offset math
js/optional/sfntPeek.mjs OPTIONAL — name records, fvar axes, head/hhea/OS2 metrics
```

Delete `js/optional/sfntPeek.mjs` and everything still works; you lose the
real font name in the header and the variable-font axis sliders.

## Modes

- **Split** — panes side by side, scroll synchronised.
- **Stack** — one above the other, for comparing line rhythm at the same measure.
- **Overlay** — both panes superimposed, B in `mix-blend-mode: multiply`.
  Where the two fonts agree the marks go dark; where they diverge you get a
  blue or magenta fringe. This is the fastest way to see advance-width and
  sidebearing differences between two versions of the same face.

## Matching visual size and baselines

Two fonts at the same `font-size` rarely *look* the same size — x-height and
cap-height are independent design decisions, not fixed fractions of the em.
**Settings → Size matches** lets the Size slider drive cap-height or x-height
instead of the literal em: each slot is resolved to whatever font-size makes
its own cap-height (or x-height) equal the slider's px value, using the
font's `OS/2` table (`sCapHeight` / `sxHeight`, version ≥ 2 only). Fonts
without that table fall back to measuring an actual "H" or "x" glyph on
canvas, and fonts with neither fall back to an assumed ratio — the slot
header always says which one happened, so you know how much to trust it.

**Settings → Align baselines** does two things together, because doing only
one doesn't actually keep multi-line text aligned:

1. Locks body-text elements (`p`, `li`, `blockquote`, `dd`, `dt`, `td`, `th`)
   in both panes to the *same literal px line-height* — the larger of
   `Line-height ratio × each font's own resolved size`. Headings are left on
   the default ratio-based leading, so heading rhythm still scales with
   heading size; only body copy is locked together.
2. Shifts the shorter font down by the difference in estimated ascent (from
   `OS/2` typo metrics if `USE_TYPO_METRICS` is set, or `hhea` otherwise), so
   the first baseline coincides too.

Do only (2) and the first line lines up but every line after it drifts apart,
because each font is still stepping to its own line-height. Both parts
together keep every line's baseline aligned, not just the first.

**Nudge A / Nudge B** are manual px offsets layered on top of that, for
closing whatever gap the automatic pass leaves — expect to need them, since
this is still built from the font's own declared numbers, and two engines can
legitimately disagree about which metrics table governs line layout.

**Nastaliq (and similarly composed scripts) are the case where you should
expect the automatic pass to fall short.** Its letters stack diagonally
rather than sitting on one shared horizontal line, so the ascender/descender
in the font describe a bounding box for that composition, not an optical
baseline the way a Latin text face's do. If the app flags "unusually large
vertical span," that's this situation — treat the auto-alignment as a rough
starting point and finish by eye with the nudge sliders.

## Caveats worth knowing

**The browser is not HarfBuzz-plus-nothing.** Blink and Gecko use HarfBuzz, but
Blink on Windows can hand shaping to DirectWrite, and Safari uses Core Text. The
same font and the same CSS will differ across the three in kerning application
order, `text-rendering` behaviour, synthetic bold, and how `font-feature-settings`
interacts with the higher-level `font-variant-*` properties. Proof in each
engine you care about; this tool cannot abstract that away.

**Fonts are sanitised before they load.** Chrome and Firefox run incoming font
data through OTS. A font that HarfBuzz shapes and that the OS installs happily
can still be rejected here — bad checksums, overlapping tables, a malformed
`DSIG`. If a font fails to load, that is information about the font, not
necessarily a bug in the tool. The error is shown in the slot header.

**Coverage detection measures advance widths.** See the header comment in
`coverage.mjs` for the failure modes. It finds most missing glyphs and will
occasionally miss one.

**`font-synthesis: none` is the default** so you see the real face rather than
the browser's faux bold and slant. Turn it on in Settings if you specifically
want to compare against synthesis.

**Ligature and kerning controls interact.** `font-feature-settings` is the
lowest-level property and overrides the corresponding `font-variant-ligatures`
and `font-kerning` values. If you type `"liga" 0` into Features, the Ligatures
dropdown stops having any effect on `liga`.

## Extending

- Real CommonMark: replace `markdownToHtml` in `content.mjs` with marked or
  markdown-it. Output still passes through the sanitiser.
- Named instances: `sfntPeek` reads the `fvar` axis array but skips the
  instance records that follow it; they are the same file offset plus
  `axisCount * axisSize`.
- Waterfalls and glyph grids: both are just alternative proof texts, so they
  belong in `content.mjs` as generators rather than as new rendering paths.
