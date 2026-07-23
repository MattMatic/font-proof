# Font Proof

Paste text, drop two fonts, compare. No build step, no dependencies.

Live: https://mattmatic.github.io/font-proof

```
python3 -m http.server 8000
# then open http://localhost:8000/
```

A server is required. ES modules are fetched with CORS rules that `file://`
fails, so opening `index.html` directly gives you a blank page and a console
full of module errors.

Written with Claude 😁

## Files

```
index.html
css/app.css
js/main.mjs              wiring
js/fontSlot.mjs          FontFace creation, registry hygiene, drag/drop
js/content.mjs           plain / Markdown / HTML → sanitised DOM
js/controls.mjs          settings schema → CSS custom properties
js/coverage.mjs          which characters fall back to another font
js/optional/sfntPeek.mjs OPTIONAL — name records and fvar axes
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
