<!-- tykerf:header -->
&nbsp;

[<img src="../../../src/editor/public/brand/tykerf-logo-docs.svg" alt="TYKERF" height="22">](../../../README.md) › [Documentation](../../README.md) › [User guide](README.md) › **Layouts, components and the theme**
<!-- /tykerf:header -->

# Layouts, components and the theme

Three things shape how a page looks, at three sizes:

| | What it is | When you use it | What it changes |
|---|---|---|---|
| **Layout** | A whole page: a structure of blocks, each box filled with a component | Once, when the page is made | The page's structure and its starting content |
| **Component** | One ready-made section: a hero, features, pricing, an FAQ, a footer… | Any time, in an empty box (*Use a component*) or by asking Kaity | That one box's code |
| **Theme** | Colours, fonts, sizes and spacing, as variables every component uses | Any time, in the Page tab; shared by every page of a site | The look of everything at once, never the structure |

A layout is a set of components arranged on a page. Once the page is made, it keeps no link back to the ready-made layout: it is an ordinary page whose blocks you can change one by one: replace a box's component, add boxes, or ask Kaity. Changing the theme restyles every component on every page, because components take all their colours and fonts from it.

## Start from a layout and a theme

A page can start from a layout and a theme. On a new site (`npm start -- my-site` on a new or empty folder), the **start screen** offers them under **A layout**, with a live preview at desktop or phone width; in a site, **New page…** (the page name next to the TYKERF logo) shows the same choices. After the first page, a site's pages share its theme, so New page… shows the layouts in that theme. To make a page directly:

```bash
npm start -- ~/tykerf-pages/my-page --layout launch --theme studio
```

TYKERF keeps a small set, each one clearly different. Layouts differ in **layout and density**, themes in **colour, type and air**. Any layout works with any theme.

| Layout | What it has | Density |
|---|---|---|
| `blank` (default) | A navigation bar and one text section | |
| `launch` | A product launch: a big headline over the product, logos, features, two feature sections, numbers, quotes, pricing, FAQ, a call to action and a dark footer | Airy |
| `company` | A headline that switches for each audience, the latest news, what you do, how it works in steps, numbers and a call to action | Balanced |
| `magazine` | A front page: a lead story and a grid of stories, a most-read list beside them, a newsletter call | Packed |
| `catalogue` | Products or services: a short intro, filters and a grid of cards, questions | Packed |
| `portfolio` | A headline beside a picture, a gallery of work, who is behind it, quotes and a contact form | Balanced |
| `article` | An article with a sidebar (it moves below the article on narrow screens) | Reading |
| `docs` | A documentation menu next to a documentation page | Reading |
| `factual` | Facts and figures: a headline, figures on dark cards, a bar chart beside one highlighted figure, a timeline and a picture banner | Balanced |
| `biased` | A case study told through its decisions: a title with a strip of facts, the work in a frame, the story in three parts, decision cards (what was chosen over what, why, what it cost), before and after, the numbers, a quote, credits, the next case and a call to action | Balanced |

| Theme | Its look |
|---|---|
| `studio` (default) | **Airy:** white and light-grey bands, a blue pill button, big type and lots of space (Inter) |
| `product` | **Packed:** crisp white and cool grey, tight sections, a wider page, small corners, bold headlines (Inter) |
| `ivory` | **Editorial:** warm paper, a clay accent, serif reading text, a sans for headings (Newsreader, DM Sans) |
| `gallery` | **Soft:** off-white, pastel cards, a tight sans; suits images and portfolios (Manrope, DM Sans) |
| `dark` | **For developers:** near-black, a mint accent, monospaced quotes and details (Inter) |
| `warm` | **Warm editorial:** stone paper, deep navy, a terracotta accent and gilt details, a serif over a sans (Playfair Display, Plus Jakarta Sans) |
| `biased` | **Ink and highlighter:** warm paper, near-black ink, an indigo accent, a lime highlighter on the words that matter and heavy rules (Manrope, Inter); made for the `biased` layout, and fine with any other |

More layouts and themes, including layouts that show TYKERF's roots in chip floorplans (a pinwheel and a page frame), are kept in [`Other_Layouts/`](../../../Other_Layouts/README.md). TYKERF doesn't offer them, but any of them can be brought back.

Themes use fonts bundled with TYKERF (Inter, Manrope, DM Sans, Newsreader, Playfair Display and Plus Jakarta Sans, all under the SIL Open Font License) or installed on the visitor's device. A page gets a copy of the bundled fonts its theme uses in its `assets/` folder, so it never calls a font server. `npm run cli -- layouts` lists layouts and themes, and `npm run cli -- new <folder> <layout> --theme <theme>` creates a page without opening the editor. Given a site (a folder of pages), it adds the page to it, named after the layout or `--name <page>`, and says so; in a site that shares one theme, the theme you name becomes that page's own values, so the other pages keep their look. A folder that is already a page, or holds other things, is refused.

All the text and images are **placeholders**: replace them in the **Text** tab, or ask Kaity ("fill this page for a bakery in Murcia").

Kaity can use components too: ask for "a FAQ here" or "make this box a pricing table", and it starts from the matching component and adapts it. On a page without a theme, Kaity can add the theme only when the top block, `page`, is selected; from a smaller block, use the component from the panel.

## Use a component

An empty box offers **Use a component** in its Text tab: navigation bar, hero (centred, split beside a picture, or with a switcher: pills that change the headline, text and figures for each audience), statement, logos, feature (beside a picture; tag it `#reverse` to swap sides), updates (news cards), story grid (a front page of stories), list (numbered links for a sidebar), text section, features, numbers, steps on a line (steps hanging from a line that fills as the section scrolls into view), testimonials, pricing, FAQ, call to action, gallery, card grid (products or services), image, contact form, footer, article, sidebar, docs menu and docs page. The component fills the box, brings its placeholder images into the page's `assets/` folder and is one undo step.

Components adapt to their width, so they work full width, in a column or on a phone. The contact form only shows a thank-you note: connect it to your own service before publishing.

## The theme

Every layout and component uses the same **theme**: colours, fonts, corner radius, spacing and content width. In a site, the theme is shared by every page; a single page has its own. Change it in the **Page** tab of the top block (`page`):

- **Where the look comes from:** a line at the top of the Page tab always says which case this page is in:

  | It says | What it means |
  |---|---|
  | **Inherited** | The page uses the site theme, like every page of the site |
  | **Inherited, with N values of its own** | The page uses the site theme, but sets some values for itself (named in the line) |
  | **Own theme** | The page has a whole theme of its own and doesn't follow the site's (an older site before *Use this theme for every page*) |
  | **Own look** | The page is a copy of a website: the site theme doesn't apply; change it in the head code |
- **Every page / This page only:** in a site, this switch says where your changes go.
  - **Every page** edits the site theme. Every page follows, except values a page sets for itself.
  - **This page only** keeps your changes on this page. Each value is marked **site** (inherited) or **this page** (its own, with a coloured edge and **reset** to inherit it again). **Use the site theme again** drops all of the page's own values.
  - Only the values that differ from the site's are kept. If the site theme later changes a value this page hasn't set, the page follows.
- **Presets:** *Studio*, *Product*, *Ivory*, *Gallery*, *Dark* and *Warm* set every value at once (one undo step). Start from one, then adjust the values below, grouped as *Colours*, *Type* and *Shape and space*.
  - TYKERF remembers the preset a theme came from and highlights it. Once you change a value, it reads ***changed*** (for example *Studio · changed*), and **Reset to Studio** puts every value back, in one undo step. Themes saved before TYKERF remembered presets show none until you pick one.
  - Under **This page only**, a preset gives just this page those colours and fonts.
  - A preset rebuilds the whole theme from TYKERF's current one. This also brings an older page up to date: it gets the newest theme values, and repairs colours that an older TYKERF left stuck in the dark and soft bands.
- **Theme:** a colour picker or a value for each setting; *Apply theme* restyles every component at once.
- The theme also sets the type scale (hero, section title, lead and body sizes), the heading weight and letter spacing, the button shape and the space between sections.
- **Alternate bands**, **Cards**, **Lines** and **Soft accent** can follow the background or the accent. When they do, they are marked *auto*; pick a colour to set your own. When a preset or you set them, **make auto** makes them follow again.
- **Head code:** everything the page adds to its `<head>` (the theme itself, fonts, page-wide styles and scripts).

Saving reloads the page, because the head can only change with a reload. Undo reverts a page's own changes; the site theme has its own **Undo the last site theme change**. With `page` selected, you can ask Kaity to change the theme of a single page. In a site, Kaity changes the shared theme only while the site has a single page (so it can style a new site's first page, from a design for example; **Undo the last site theme change** reverts it). Once there are other pages, Kaity gives the page its own values over the shared theme, like *This page only*, and the other pages keep theirs. TYKERF offers its bundled fonts and fonts installed on the visitor's device: loading fonts from another server would send every visitor's IP address to that server. Choosing a bundled font copies its file into the page. To use another web font, put its files in `assets/` and declare them in the head code.

### Bands

A page reads better when its sections alternate. Tag a section's box to give it a band tone, or to pack it tighter; every component follows:

| Tag | Band |
|---|---|
| `#tone-alt` | The alternate band colour (a shade of the background) |
| `#tone-soft` | A soft wash of the accent |
| `#tone-dark` | The dark band: its text turns light. Use it once or twice per page, for a footer or one strong section |
| `#dense` | Not a colour: the section is packed tighter (less space around it, smaller titles), whatever the theme. Combine it with a tone (`#tone-alt #dense`) |

Every layout is checked in a browser in the main presets: text on every band meets the WCAG AA contrast ratio, headings keep their order, and nothing scrolls sideways on a phone. If you change colours yourself, keep secondary text dark enough on the alternate and soft bands.

Set them in the **Size & look** tab of any block (*Band* and *Density*), ask Kaity ("make the testimonials an alternate band", "a dark footer"), or add the tag with the MCP `tag` tool. The **Blocks** tab shows each block's band and density. The *Feature* component also takes `#reverse` to put its picture first.

Using a component on a page that has no theme yet (an imported site, for example) adds only the theme's variables, so the rest of that page keeps its look.

## Images

Put the images your page uses in its `assets/` folder and refer to them as `assets/<file>` (the Text tab shows image addresses as plain fields). When you render the page, `assets/` is copied next to it, in `out/assets/`.

<!-- tykerf:footer -->
---

← [Getting good results from Kaity](asking-kaity.md) · [User guide index](README.md) · [Copying a website](importing.md) →

[TYKERF](../../../README.md) · [Documentation](../../README.md) · [GitHub](https://github.com/eonity-org/tykerf) · Apache-2.0 · an [eonity](https://eonity.org) project
<!-- /tykerf:footer -->
