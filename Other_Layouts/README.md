<!-- tykerf:header -->
&nbsp;

[<img src="../src/editor/public/brand/tykerf-logo-docs.svg" alt="TYKERF" height="22">](../README.md) › **Other layouts**
<!-- /tykerf:header -->

# Other layouts

TYKERF offers a small set of layouts, themes and components that are truly different from each other (see [the layouts guide](../docs/user-guide/en/layouts.md)). This folder keeps the rest:
- earlier ones that were too close to the ones TYKERF offers;
- layouts that show where TYKERF comes from.

TYKERF never loads this folder: the start screen, *Use a component* and the AI only see `library/`. A test (`test/library.test.ts`) checks that everything here stays valid, so any item can be brought back.

## Where TYKERF's layouts come from

TYKERF describes a web page the way chip designers describe the floorplan of an integrated circuit: a **slicing tree**. The rectangle is cut, then each part is cut again, down to the blocks that hold content.

| Operator | In chip layout | In a TYKERF page |
|---|---|---|
| `H` / `V` | A horizontal or vertical cut (a slicing floorplan; Otten 1982, Wong & Liu 1986) | A column (blocks stacked) or a row (blocks side by side) |
| `W` | The **pinwheel** (or wheel): four blocks wound around a centre, the basic floorplan that no straight cut can divide | Four sections around a central one |
| `P` | A **periphery**: a core with blocks along its edges | A page frame: header, side bars, content, footer |

The two layouts below show the W and P operators. TYKERF's own layouts use only rows and columns, because they read and reflow most simply. The notation is defined in [docs/slicing-notation.md](../docs/slicing-notation.md).

## What is here

| File | Holds |
|---|---|
| `library/layouts.json` | **Pinwheel** (`W`) and **Periphery** (`P`), the IC-inspired layouts; *SaaS landing* and *Landing page*, close to *Product launch* |
| `library/themes.json` | *Clean* (the base theme's own values, which TYKERF still uses as the default for `createPage`), *Warm classic* (`warm-classic`, close to *Ivory*; the offered *Warm* is a different theme), *Bold*, *Editorial*, and the first *Dark* theme (navy, replaced by the new *Dark*) |
| `library/components.json`, `components/` | *About*, a picture beside a short story (the *Feature* component tagged `#reverse` does the same) |

**Pinwheel:**

```
nav  top right bottom left center W@wheel  footer  H3@page
rule r1 below=900 flip wheel          (on phones the five blocks stack)
```

**Periphery:**

```
nav menu content aside footer P@page     (north, west, centre, east, south)
rule r1 below=900 flip page
```

## Bring one back

1. Move its entry from `Other_Layouts/library/<file>.json` into the same file in `library/`, and, for a component, its `.html` into `library/components/`.
2. Run `npm test`. `test/design.test.ts` checks every offered layout in the main themes for readable contrast, heading order and phone widths, so fix what it reports. Then update the layout and theme counts in `test/site-editor.test.ts` and `test/library.test.ts`.

To try a layout without bringing it back, write its `layout` line into a page's `layout.slice` (each box name gets a component with *Use a component*), or paste it into `npm run cli -- outline "<layout>"`. `outline` takes the tree only, without the `rule` lines.

Pages made earlier with any of these keep working as they are: a page holds its own copy of each component's code and of its theme values.

<!-- tykerf:footer -->
---

[TYKERF](../README.md) · [Documentation](../docs/README.md) · [GitHub](https://github.com/eonity-org/tykerf) · Apache-2.0 · an [eonity](https://eonity.org) project
<!-- /tykerf:footer -->
