<!-- tykerf:header -->
&nbsp;

[<img src="../../src/editor/public/brand/tykerf-logo.svg" alt="TYKERF" height="20" style="border-radius:0">](../../README.md) › [Roadmap](../../ROADMAP.md) › **Templates redesign: modern, light, launch pages**
<!-- /tykerf:header -->

# Templates redesign: modern, light, launch pages

## Why
TYKERF's templates looked dated:
- system fonts only;
- one accent colour;
- every section the same band with the same spacing;
- grey placeholder boxes.

The user asked for modern, stylish launch pages with better colour, space and sizing, and gave five references: apexdesk.github.io, fullframe.eonity.org, anthropic.com, mercury.com and apple.com. They also asked to avoid the all-dark look.

## What the references share (measured at 1440 and 375 px)

| | Measured |
|---|---|
| Background | Warm off-white, not pure white; bands alternate two close light tones (`#FAF9F5`/`#F0EEE6`, `#FFF`/`#F5F5F7`, `#FAFAF8`) |
| Text | Near-black (`#141413`, `#1D1D1F`, `#0B0E16`) |
| Hero | 52–160 px, letter spacing −2 to −5 %, weight 550–800 |
| Section titles | 42–52 px |
| Body | 15–20 px, line height about 1.5 |
| Accent | One accent, mostly on the main button (clay `#D97757`, blue `#0071E3`); pastel card fills (`#EAC09F`, `#C7CBD4`) |
| Dark | At most one band (footer or one hero), never the base |
| Shapes | Pill buttons; cards rounded 8–24 px |
| Labels | Uppercase eyebrow labels, 11–14 px, letter spacing about +0.12 em |
| Space | Content 1024–1280 px wide; 100–160 px between sections |
| Type mix | A sans for headings with a serif accent (Anthropic, FullFrame); real product images |

## Decisions
- **Light by default.** Dark is a band tone (`#tone-dark` on a section), not a theme. The old *Dark* preset stays for those who want it.
- **Bundled fonts** (SIL OFL, Latin subset, variable weight), in `templates/fonts/`:
  - Inter, Manrope and DM Sans;
  - Newsreader for serif accents, with its italic.

  A page gets only the fonts its theme uses: they are copied to `assets/`, with `@font-face` rules in a `<style data-tykerf-fonts>` block of the head. Nothing loads from a CDN.
- **Theme variables added** (each validated by kind):
  - colours: `--color-band`, `--color-soft`, `--color-dark`, `--color-on-dark`;
  - type: `--font-accent`, `--weight-heading`, `--tracking-heading`, and the type scale `--text-hero`, `--text-title`, `--text-lead`, `--text-body`;
  - shapes and space: `--radius-button`, `--space-section`.
- **Band tones** are tags on a section box: `#tone-alt`, `#tone-soft` and `#tone-dark`. They set `--section-bg` and the colours inside. Components paint `background: var(--section-bg, transparent)`, so any section takes any tone, and a dark band turns its own text light.
- **Presets** drawn from the references: *Ivory*, *Gallery*, *Studio* and *Product*. The old presets stay valid.

## Steps
1. Theme variables, band tones, fonts, validation and tests.
2. Components rebuilt on the new values:
   - eyebrows on every section;
   - heroes: centred, split, and with cards;
   - stats, features with a screenshot, releases, a dark footer;
   - SVG placeholders in the theme's colours.
3. Launch templates: product launch, SaaS landing, studio, company or announcements. A sample of each preset goes to the user before the rest.
4. Checks:
   - text contrast on every tone;
   - no sideways scroll at 375 px;
   - heading order;
   - existing pages keep working.

## Status (2026-10-13)
- **Done:**
  - steps 1 to 4;
  - the user preferred *Studio* and *Product*: Studio is the default and both come first;
  - templates: `launch`, `saas` and `company`, with `portfolio` and `landing` restyled;
  - every component restyled;
  - `test/design.test.ts` checks contrast, heading order and sideways scroll for every template in five presets.
- **Tuned for contrast:** Studio's blue (`#0066cc`) and grey, Ivory's clay, the base blue, and secondary text on soft bands.

## Simplified (2026-10-14)
The user asked for a minimum set where each item is clearly different (KISS), with dark themes welcome.
- **Themes, five:** *Studio* (airy), *Product* (reworked as packed), *Ivory* (editorial), *Gallery* (soft) and a new *Dark* for developers.
- **Templates, eight:** *SaaS* and *Landing* retired, and two new packed ones, *Magazine* and *Catalogue*.
- **Components:** *About* retired; *Story grid*, *Card grid* and *List* added.
- **`#dense`** packs any section tighter.
- **Retired items** live in `Other_Layouts/`, next to the IC showcase layouts (pinwheel and periphery).

<!-- tykerf:footer -->
---

↑ [Roadmap](../../ROADMAP.md)

[TYKERF](../../README.md) · [Documentation](../README.md) · [GitHub](https://github.com/eonity-org/tykerf) · Apache-2.0 · an [eonity](https://eonity.org) project
<!-- /tykerf:footer -->
