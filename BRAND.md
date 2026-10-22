# TYKERF brand

TYKERF is a product of eonity. A *kerf* is the cut a saw leaves: the product is about cutting a page into blocks and working on one of them. The **TY** signature, inherited from EONI**TY**, connects TYKERF to the **EONITY** product family, as in TYDAL.

In sentences the name is written in capitals, **TYKERF**; the wordmark is lowercase, **tykerf**. Code, packages, folders and addresses use `tykerf`.

## The mark

The mark is a real slicing tree, written in TYKERF's own notation:

```
5 1 4 2 3 V H V H
```

- **5**: a band across the top.
- **1**: a tall block on the left.
- **4** (the accent colour): the block in focus, the one you are working on.
- **2 3**: two small blocks under it.

The channels between the blocks (the kerfs) draw a **T**. The channels between 4, 2 and 3 add a **y**, so together they read "ty", as in TYKERF, TYDAL and eonity. The accent is never decoration: it always means *the block in focus*.

## Files (`src/editor/public/brand/`)

| File | Use |
|---|---|
| `tykerf-mark.svg` | The mark at 32 px and up |
| `tykerf-mark-small.svg` | 16–24 px (favicons, buttons). It is redrawn with wider cuts so they don't fill in |
| `tykerf-mark-white.svg` | On TYKERF blue or photos |
| `tykerf-mark-mono.svg` | One colour (greyscale, black-and-white print): no accent cell, recolour freely |
| `tykerf-app-icon.svg` | App icon / social avatar: the white small mark on a TYKERF-blue tile |
| `tykerf-logo.svg` | Mark plus the wordmark "tykerf" (IBM Plex Sans Light 300, tracking −0.02em). The wordmark spans the mark's full height: baseline on the mark's bottom edge, the tops of k and f on its top edge, the y descending below it; the file includes 2.5 units of clear space on every side. Convert the text to outlines before print |
| `png/` | PNG versions, transparent: the mark (16–1024 px; 16–32 px use the small drawing), white and mono marks (32–512), the app icon (32, 180, 192, 512, 1024) and the logo (mark 32–512 px high, plus the same clear space on every side, so the files are about a third taller than the mark, for the descender of the y). Regenerate with `npx tsx scripts/brand-png.ts` |

In the editor panel the logo is the white mark plus the wordmark "tykerf" (IBM Plex Sans Light), followed by a thin divider and the path of the selected block. Below 700 px only the mark is shown.

Rules:
- Clear space around the mark: at least the width of one channel × 3.
- Don't recolour the blocks individually, rotate the mark, or add a border. The blocks are Tydal teal (white on dark), and only block 4 is in the accent colour.

## Colours

The palette is Tydal teal + amber. Amber `#EA9A27` is mycolor.space's match for Tydal teal `#0A5475`; against each other they are 3.6:1, so cell 4 stays visible in greyscale and at 16 px.

| Token | Hex | Use |
|---|---|---|
| Tydal teal | `#0A5475` | Mark, wordmark, primary buttons, panel header |
| Teal, lighter | `#2A7699` | Hover frames, links, active tab underline |
| Teal, light | `#6FA6C0` | Secondary lines, dark-mode accent |
| Amber | `#EA9A27` | Focus: the selected block, its frame on the page, cell 4 of the mark |
| Cream | `#F3F0E8` | Ground for brand pages (Tydal) |
| Ink | `#10303F` | Body text on light grounds |

In the editor the palette is CSS variables in `src/editor/public/tykerf.css` (`--teal`, `--amber`, `--brand`, `--focus`, `--focus-under`), so the accent changes in one place.

Contrast:
- Teal is strong on white (8.3:1), so it carries text and buttons.
- Amber stays visible against teal in greyscale and at 16 px. It is weak on white, so it is never used for text, and the selected block's dashed frame has a solid ink line under it.
- Destructive actions use a separate red (`#B42318`) and always carry a label and an icon.

## Type

IBM Plex Sans and IBM Plex Mono, free under the SIL Open Font License 1.1 (commercial use, embedding and bundling allowed; the fonts themselves may not be sold on their own, and a modified version may not be called "Plex").

| Use | Weight |
|---|---|
| Wordmark | Plex Sans Light 300 |
| Panel labels, buttons, tabs | Medium 500 / SemiBold 600 |
| Headings, selected tree line | SemiBold 600 / Bold 700 |
| Text, AI conversation | Regular 400 |
| Paths and postfix strings (`page / intro / title`, `5 1 4 2 3 V H V H`) | Plex Mono 400 |

Don't use Thin 100 or ExtraLight 200 below display sizes: they break up on screens.

The editor bundles the fonts it uses (`src/editor/public/fonts/`, Latin-1 WOFF2 files with `OFL.txt`) and serves them from `/_tykerf/fonts/`. It never loads them from a font CDN: a request to Google Fonts would send the visitor's IP address to a third party, which needs consent under the GDPR. The families are declared as `tykerf-plex-sans` / `tykerf-plex-mono` so they can't clash with a site that uses Plex itself.

## Literature

TYKERF is inspired by slicing floorplans in IC design: Otten (1982), Wong & Liu (1986), Stockmeyer (1983), and Nagy & Seth (1984) for XY-cut. See [the slicing notation](docs/slicing-notation.md).

## Kaity

**Kaity** is TYKERF's assistant: eonity's AI as it works in TYKERF. Tydal's is **Aity**; the K keeps the two apart. Write it **Kaity** in sentences ("Kaity is building your page", "Ask Kaity"). It is a name, so it is never translated.

- **Symbol:** the three balls of eonity's isotype, as Tydal's Aity indicator uses them (radii 4.5 / 3.6 / 2.7 in a 20 × 10 box).
  - **At rest:** the logo's blues, `#1A5D7D` / `#287C9C` / `#5295B3`.
  - **While Kaity works:** the brighter set `#0A4F6E` / `#0E7EA0` / `#1CB0D2`. The balls pulse in turn, small to large, every second, and grow 7% at the peak.
  - **Reduced motion:** when the system asks for it, the balls stay still.

  The TYKERF mark is not used for Kaity, so that the product and its assistant don't look alike. Kaity never appears without TYKERF, though: where Kaity shows outside the panel (the window that follows a page being built), the TYKERF logo (mark and wordmark, in the accent blue) heads it, above Kaity's symbol and name.
- **Where it shows:**
  - the *Kaity* tab of a block, and the line above the composer (*Kaity · works on cta only*, with the model in use);
  - Kaity's replies;
  - the start screen's *Show or describe it*, and the window that follows a page being built;
  - *Kaity status…* in the Site menu.
- **The model stays visible:** the model that answers (Claude Code, the Anthropic API, Gemini) is shown next to the name. Kaity is the assistant, the model is its engine.
