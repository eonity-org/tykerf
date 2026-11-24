<!-- tykerf:header -->
&nbsp;

[<img src="src/editor/public/brand/png/tykerf-logo-48.png" alt="TYKERF" height="24">](README.md) › **TYKERF brand**
<!-- /tykerf:header -->

# TYKERF brand

TYKERF is a product of Eonity, one of the **ty** family with TYDAL and TYSET. The **ty** comes from Eon**ity**. A *kerf* is the cut a saw leaves: the product is about cutting a page into blocks and working on one of them. This page is TYKERF's part of the family guide (*Marca de la familia ty*); where they differ, the family guide wins.

In sentences the products are written in capitals, **TYKERF**, **TYDAL**, **TYSET**, and the company with a capital, **Eonity**; never "Tykerf" or "TyKerf". The logo is lowercase, **tykerf**. Code, packages, folders and addresses use `tykerf`.

## The logo

The logo is two parts:

1. **The "ty" isotype**, the same in every product of the family: the "t" and the "y" linked, the tail of the "y" running back along a thin line to the three balls under the "t". It is a fixed drawing: never redrawn, respaced or recomposed.
2. **"kerf"**, set in **Manrope Bold 700**, without tracking, on the isotype's baseline.

| Part | Colour |
|---|---|
| "t" and "y" | Teal TYDAL `#0A5475` |
| "kerf" | Teal claro `#287C9C` |
| Thin line | Gradient from `#1A5D7D` to `#0A5475` |
| Balls, large to small | `#1A5D7D`, `#287C9C`, `#5295B3` |

- **Colour**, on white and light grounds, is the main version. **White**, on teal, dark grounds or a calm dark part of a photo, is all white: isotype, "kerf", line and balls.
- "kerf" is never amber: the amber belongs to the block in focus.
- The logo is a picture, exported from the master at the exact pixel size it is shown (and at twice that size for sharp screens). As SVG the thin line breaks up at small sizes, so there is no SVG logo.
- **Minimum height:** 24 px. Below 48 px the thin line fades.
- **Clear space:** at least the thickness of the "t"'s stem (about 13 % of the logo's height) on every side. The PNGs already carry a transparent margin (about 8 % of their height); the clear space is measured from the drawing, not from the file's edge.

## The icon

The icon is a square frame around a real slicing tree, written in TYKERF's own notation:

```
5 1 4 2 3 V H V H
```

- **5**: a band across the top.
- **1**: a tall block on the left.
- **4** (amber): the block in focus, the one you are working on.
- **2 3**: two small blocks under it.

It shares its grammar with the family's icons (TYDAL's gallery, TYSET's half page): **a square frame, its own content, and in amber what is in focus**. On a 64 × 64 grid: the frame is 59.5 × 59.5 with a 4.5 stroke and a radius of 4, in Teal TYDAL, empty inside; the blocks fill a 42 × 42 box in the middle, with a radius of 1.5 and gaps of 3. Blocks 5, 2 and 3 are Teal TYDAL, block 1 Teal claro, block 4 amber.

- **On dark grounds** the frame and the blocks are white; the amber stays.
- **One drawing for every size**, down to 16 px.
- **Alone** it is the favicon, the app icon and the avatar.
- **With the logo** (the lockup: lists of products, the start of the app) it stands on the left, as tall as the x-height (the "e"), about 59 % of the logo's height: its top on the x-height, its bottom on the baseline. The gap to the "t" is 16 % of the logo's height. Never at the logo's full height, never on its right.

Rules:
- Exactly one amber element, always the block in focus. The amber is never decoration.
- Don't redraw, rotate, slant or stretch the icon, recolour its blocks other than as above, or add shadows, outlines or gradients.
- Don't mix square icons with icons of other shapes in one list.

## The glyph: TYKERF inside its own screens

Inside the editor TYKERF signs with the **glyph**: the same tree without the frame, its five blocks filling the square (the band 20 high, cuts of 7, corners of 6; the amber cell 12 high). At the sizes of a toolbar (18–24 px) the framed icon's blocks shrink to a few pixels; the glyph keeps them big enough to be TYKERF's. The glyph is the icon's content, so the two never disagree.

- **Colours:** one colour, the text's (white on the teal headers, Teal TYDAL on light grounds), and cell 4 always amber.
- **The editor panel's header** carries the glyph alone, before the path of the selected block: the logo would be below its minimum height there.
- **The other headers of TYKERF's screens** (the sign-in, *page not found*, the site manager and the handbook) are the glyph followed by the white logo, 32 px high; the job window has the same pair in colour, white in dark mode. This pair is not the family's lockup: the glyph stands at the logo's visible height, which keeps both readable in a header (the lockup's icon, as tall as the "e", would be about 20 px there). The lockup stays for lists of products.

## The edition: Community Edition

This is **TYKERF Community Edition** (*TYKERF CE* where short), the free, open edition; **TYKERF** is the full one. Where the logo signs TYKERF's own screens (the headers of the sign-in, *page not found*, site manager and handbook pages, and the job window) the legend **Community Edition** follows it:

- a thin rule 10 px after the logo (white at 45 % on teal, the text's colour on light grounds), then **COMMUNITY / EDITION** on two lines, IBM Plex Sans SemiBold 11 px, capitals with 0.06em tracking, in the logo's colour; centred on the logo's letters. Where the header goes on with the page's own words (the site manager, the handbook), a fainter rule separates them from the signature;
- always text beside the logo's picture, never inside it, and never with the icon alone (the editor panel's header, the tab icon, the app icon);
- the two editions sign differently on purpose: this one with the white logo straight on the teal bar, TYKERF with its logo in a white cartouche. Never give this edition the cartouche.

## Files (`src/editor/public/brand/`)

| File | Use |
|---|---|
| `tykerf-mark.svg` | The icon, colour, transparent inside the frame |
| `tykerf-mark-white.svg` | On TYKERF teal, dark grounds or photos: all white, the amber kept |
| `tykerf-mark-mono.svg` | One colour (greyscale, black-and-white print): no accent, recolour freely |
| `tykerf-app-icon.svg` | App icon, avatar (Claude Desktop, the plugin, GitHub): the icon with white inside the frame, so it reads on a dark dock. The editor's tab icon (`src/editor/public/favicon.svg`) is the same drawing |
| `png/tykerf-mark-*.png`, `-white-*`, `-mono-*`, `png/tykerf-app-icon-*.png` | The icons as PNG, transparent: the mark 16–1024 px, white and mono 32–512, the app icon 32, 180, 192, 512 and 1024. Regenerate with `npx tsx scripts/brand-png.ts` |
| `png/tykerf-logo-<height>.png`, `png/tykerf-logo-white-<height>.png` (served at `/_tykerf/brand/png/`) | The logo, exported from the family's master (3800 × 1400) at each height it is shown, at twice that size: colour 32 and 64 (the job window), 48 (the docs header, shown at 24) and 280 (the README, shown at 140); white 32 and 64 (the teal headers) and 280 (the README in dark mode). The height is the whole file, margin included |

The editor draws the glyph inline (`ICON.tykerf` in `tykerf.js`, and the headers of the sign-in, *page not found*, site manager and handbook pages).

## Colours

The family palette is teal and amber. Amber `#EA9A27` is mycolor.space's match for Teal TYDAL `#0A5475`; against each other they are 3.6:1, so cell 4 stays visible in greyscale and at 16 px. Always work in sRGB: in Adobe RGB or CMYK the teals shift.

| Token | Hex | Use |
|---|---|---|
| Teal TYDAL | `#0A5475` | The "ty", the icon's frame and dark blocks, primary buttons, the editor's bar, the dark brand ground |
| Teal claro | `#287C9C` | "kerf", the icon's block 1, the middle ball |
| Teal medio | `#1A5D7D` | The large ball, the start of the line's gradient |
| Pizarra | `#5295B3` | The small ball |
| Amber | `#EA9A27` | Focus only: the selected block, its frame on the page, cell 4 of the icon |
| Cream | `#F3F0E8` | Alternative light ground for brand pages |
| Ink | `#10303F` | Body text on light grounds |

In the editor the palette is CSS variables in `src/editor/public/tykerf.css` (`--teal`, `--amber`, `--brand`, `--focus`, `--focus-under`), so the accent changes in one place.

Contrast:
- Teal is strong on white (8.3:1), so it carries text and buttons.
- Amber stays visible against teal in greyscale and at 16 px. It is weak on white, so it is never used for text, and the selected block's dashed frame has a solid ink line under it.
- Destructive actions use a separate red (`#B42318`) and always carry a label and an icon.

## Type

The logo's "kerf" is Manrope Bold 700, and only inside the logo's picture: the editor never sets the logo as text. The editor itself uses IBM Plex Sans and IBM Plex Mono. All three are free under the SIL Open Font License 1.1 (commercial use, embedding and bundling allowed; the fonts themselves may not be sold on their own, and a modified version may not keep the font's name).

| Use | Weight |
|---|---|
| Panel labels, buttons, tabs | Medium 500 / SemiBold 600 |
| Headings, selected tree line | SemiBold 600 / Bold 700 |
| Text, AI conversation | Regular 400 |
| Paths and postfix strings (`page / intro / title`, `5 1 4 2 3 V H V H`) | Plex Mono 400 |

Don't use Thin 100 or ExtraLight 200 below display sizes: they break up on screens.

The editor bundles the fonts it uses (`src/editor/public/fonts/`, Latin-1 WOFF2 files with `OFL.txt`) and serves them from `/_tykerf/fonts/`. It never loads them from a font CDN: a request to Google Fonts would send the visitor's IP address to a third party, which needs consent under the GDPR. The families are declared as `tykerf-plex-sans` / `tykerf-plex-mono` so they can't clash with a site that uses Plex itself.

## Literature

TYKERF is inspired by slicing floorplans in IC design: Otten (1982), Wong & Liu (1986), Stockmeyer (1983), and Nagy & Seth (1984) for XY-cut. See [the slicing notation](docs/slicing-notation.md).

## Kaity

**Kaity** is TYKERF's assistant: Eonity's AI as it works in TYKERF. TYDAL's is **Aity**; the K keeps the two apart. Write it **Kaity** in sentences ("Kaity is building your page", "Ask Kaity"). It is a name, so it is never translated.

- **Symbol:** the three balls of the "ty" isotype, as TYDAL's Aity indicator uses them (radii 4.5 / 3.6 / 2.7 in a 20 × 10 box).
  - **At rest:** the logo's blues, `#1A5D7D` / `#287C9C` / `#5295B3`.
  - **While Kaity works:** the brighter set `#0A4F6E` / `#0E7EA0` / `#1CB0D2`. The balls pulse in turn, small to large, every second, and grow 7% at the peak.
  - **Reduced motion:** when the system asks for it, the balls stay still.

  The TYKERF icon is not used for Kaity, so that the product and its assistant don't look alike. Kaity never appears without TYKERF, though: where Kaity shows outside the panel (the window that follows a page being built), the TYKERF logo heads it, above Kaity's symbol and name.
- **Where it shows:**
  - the *Kaity* tab of a block, and the line above the composer (*Kaity · works on cta only*, with the model in use);
  - Kaity's replies;
  - the start screen's *Show or describe it*, and the window that follows a page being built;
  - *Kaity status…* in the Site menu.
- **The model stays visible:** the model that answers (Claude Code, the Anthropic API, Gemini) is shown next to the name. Kaity is the assistant, the model is its engine.

<!-- tykerf:footer -->
---

[TYKERF](README.md) · [Documentation](docs/README.md) · [GitHub](https://github.com/eonity-org/tykerf) · Apache-2.0 · an [eonity](https://eonity.org) project
<!-- /tykerf:footer -->
