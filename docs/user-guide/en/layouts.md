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

## Start from a kind of page and a frame

A page starts from **what it is** (a *purpose*: the sections that kind of page needs) in **what holds it** (a *frame*: the navigation bar, a footer, a side menu). On a new site (`npm start -- my-site` on a new or empty folder), **New page** offers them under **From a kind of page**, each described as you choose it, with the theme the site will share and **Preview at full size**; in a site, **+ Page** in the site's sidebar offers the same, in the site's theme. Kaity chooses the same way: she decides what the page is for first, then keeps only the sections it needs. To start a site with its home page directly (`<frame>+<purpose>`, or a frame alone):

```bash
npm start -- ~/tykerf-sites/my-site --layout basic+place --theme natural
npm start -- ~/tykerf-sites/my-site --layout basic+person --theme ivory --name cv   # named cv, not home
```

| Purpose | For | Sections |
|---|---|---|
| `place` | A place people visit: a shop, a bakery, a restaurant, a studio, a venue | An intro, what it offers (prices optional), pictures, when and where, contact |
| `person` | One person: a CV, a freelancer, an artist | An intro, about, their path, their work, contact |
| `event` | Something on a date: a wedding, a concert, a workshop, a conference | An intro, the programme, the people, when and where, questions, a sign-up form |
| `organization` | An association, a club, a school, a charity, a council | What it stands for, what it does, its people, a few figures, how to join, contact |
| `concept` | A product, an idea or a project to try or back | An intro, what it does, how it works, a closer look, prices, questions, the next step |
| `post` | Something to read: an article, a story, news, a notice | The article, more to read |
| `guide` | Something to follow: a how-to, a recipe, a help page, documentation | What it is for, the steps, the details, questions |

| Frame | What holds the page |
|---|---|
| `simple` | Only a navigation bar: build any sections in the body |
| `basic` (default) | A navigation bar and a footer, with a side menu if you want one |
| `full` | A navigation bar, a page title shared by every page, a side menu, a side note with key facts, and a footer; the side menu and the side note are optional |

A layout or a theme is where Kaity *starts*, not a mould: she changes the sections, their order and their code until the page fits the request, builds the structure herself when the request or a picture describes one, and adjusts the theme's colours and fonts to the site when it has an identity of its own (a logo, brand colours, photos). Her answer says what she started from and what she changed. In a site, a page whose kind you choose starts in the site's frame (see *About this site* in [Sites](sites.md)).

### What Kaity knows about each kind of page

Each purpose comes with a **skill**: a short text, `library/skills/<purpose>.md` (`place.md`, `event.md`…), saying what that kind of page needs (for a place: the hours, the address with a map link, a phone people can tap), what only you can tell her, and how it links (profiles on other websites at their full address, a page you haven't made yet at the address it will have). Kaity reads it when she starts a page of that kind, and again when you ask her for more on it later.

What only you know (your hours, your prices, the names, your Instagram profile) she doesn't make up: when your request doesn't give it, she writes a plain example and **lists it at the end of her answer** for you to confirm or replace, or asks you for it in a task. The skills are plain text: edit them to change what Kaity does for every page of that kind.

Some components carry a note of their own, in `library/components.json` (`use`): the figures, quotes, logos, people and prices she uses only when you give them (otherwise she leaves the section out), what the contact form needs to really send (the address of a form service), how the questions of an FAQ are added. She reads it whenever she places that component, on any kind of page.

The frame's navigation and footer (and in `full`, the page title) are [shared blocks](sites.md#the-site-kit) in a site: the site's first page makes them, and every page made later shows them, unless you untick *With the site's navigation and footer (shared)*.

The older ready-made layouts (`blank`, `launch`, `company`, `magazine`, `catalogue`, `portfolio`, `article`, `docs`, `factual`, `biased`) are no longer offered, but still work by name (`--layout launch`, or MCP `use_layout` with `name`).

Pick the theme by the page's tone, not by habit: each says what it is for and what it is not for.

| Theme | Its look | For | Not for |
|---|---|---|---|
| `studio` (default) | **Airy:** white and light-grey bands, a blue pill button, big type and lots of space (Instrument Sans) | software, products, studios, anything modern and calm | warm or homely places, official notices |
| `ivory` | **Editorial:** warm paper, a clay accent, serif reading text, a sans for headings (Newsreader, DM Sans) | restaurants, bakeries and food, posts, stories, writers, events with a personal tone | software, pages read in a hurry |
| `natural` | **Outdoors:** a pale sage background, deep green and clay, a soft serif for headings (Fraunces, DM Sans) | gardens, farms, nature, outdoor activities and the clubs around them | restaurants and food, clinics and charities, software, nightlife, official notices |
| `vivid` | **Loud:** white with one strong magenta, a near-black band, heavy headings (Bricolage Grotesque, Instrument Sans) | concerts, festivals, sport, shows, young audiences | notices, health, finance, long reading |
| `civic` | **Plain and clear:** white, a sober blue, large body text, high contrast, square corners (Public Sans) | councils, schools, charities, clinics and health services, notices, forms, guides everyone must be able to read | portfolios, nightlife, luxury |
| `playful` | **Friendly:** a light lilac background, violet and butter yellow, round corners (Nunito) | children, families, clubs, hobbies, parties, classes | legal, medical, finance, formal notices |
| `dark` | **For developers:** near-black, a mint accent, monospaced details (Instrument Sans) | code, documentation, developer tools, night events | families, health, official pages |

The older themes (`product`, `warm`, `gallery`, `biased`) are no longer offered, but still work by name (`--theme warm`, or MCP `use_theme`), and a page made with one keeps its look; its Page tab still shows it.

More layouts and themes, including layouts that show TYKERF's roots in chip floorplans (a pinwheel and a page frame), are kept in [`Other_Layouts/`](../../../Other_Layouts/README.md). TYKERF doesn't offer them, but any of them can be brought back.

Themes use fonts bundled with TYKERF (Instrument Sans, Public Sans, Fraunces, Bricolage Grotesque, Nunito, DM Sans and Newsreader, and for older pages Inter, Manrope, Playfair Display and Plus Jakarta Sans, all under the SIL Open Font License) or installed on the visitor's device. A page gets a copy of the bundled fonts its theme uses in its `assets/` folder, so it never calls a font server. `npm run cli -- layouts` lists layouts and themes, and `npm run cli -- new <folder> <layout> --theme <theme>` creates a page without opening the editor. In a new or empty folder it makes a site, with the page as its home page (`home`, or `--name <page>`). Given a site (a folder of pages), it adds the page to it, named after the layout or `--name <page>`, and says so; in a site that shares one theme, the theme you name becomes that page's own values, so the other pages keep their look. A folder that is already a page, or holds other things, is refused.

All the text and images are **placeholders**: replace them in the **Text** tab, leave Kaity a task on them, or ask her ("fill this page for a bakery in Murcia").

Kaity can use components too: ask for "a FAQ here" or "make this box a pricing table", and it starts from the matching component and adapts it. On a page without a theme, Kaity can add the theme only when the top block, `page`, is selected; from a smaller block, use the component from the panel.

## Use a component

Some components come with a behaviour: the contact form says thank you when it is sent, the FAQ keeps one answer open at a time, and the footer's year is always the current one. In a site, using one brings its behaviour into the site kit ([the library's behaviours](sites.md#the-site-kit)).

An empty box offers **Use a component** in its Text tab: navigation bar, hero (centred, split beside a picture, or with a switcher: pills that change the headline, text and figures for each audience), statement, logos, feature (beside a picture; tag it `#reverse` to swap sides), updates (news cards), story grid (a front page of stories), list (numbered links for a sidebar), text section, features, numbers, steps on a line (steps hanging from a line that fills as the section scrolls into view), testimonials, pricing, FAQ, call to action, gallery, card grid (products or services), image, contact form, footer, article, sidebar, docs menu and docs page. The component fills the box, brings its placeholder images into the page's `assets/` folder and is one undo step.

Components adapt to their width, so they work full width, in a column or on a phone. The contact form only shows a thank-you note: connect it to your own service before publishing.

## The theme

Every layout and component uses the same **theme**: colours, fonts, corner radius, spacing and content width. The site's theme is shared by every page; a page can have its own values over it (*This page only*). Change it in the **Page** tab of the top block (`page`):

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
- **Presets:** *Studio*, *Ivory*, *Natural*, *Vivid*, *Civic*, *Playful* and *Dark* set every value at once (one undo step). Start from one, then adjust the values below, grouped as *Colours*, *Type* and *Shape and space*.
  - TYKERF remembers the preset a theme came from and highlights it. Once you change a value, it reads ***changed*** (for example *Studio · changed*), and **Reset to Studio** puts every value back, in one undo step. Themes saved before TYKERF remembered presets show none until you pick one.
  - Under **This page only**, a preset gives just this page those colours and fonts.
  - A preset rebuilds the whole theme from TYKERF's current one. This also brings an older page up to date: it gets the newest theme values, and repairs colours that an older TYKERF left stuck in the dark and soft bands.
- **Theme:** a colour picker or a value for each setting; *Apply theme* restyles every component at once.
- The theme also sets the type scale (hero, section title, lead and body sizes), the heading weight and letter spacing, the button shape and the space between sections.
- **Alternate bands**, **Cards**, **Lines** and **Soft accent** can follow the background or the accent. When they do, they are marked *auto*; pick a colour to set your own. When a preset or you set them, **make auto** makes them follow again.
- **Head code:** everything the page adds to its `<head>` (the theme itself, fonts, page-wide styles and scripts).

Saving reloads the page, because the head can only change with a reload. Undo reverts a page's own changes; the site theme has its own **Undo the last site theme change**. With `page` selected, you can ask Kaity to change the page's theme. She changes the site's shared theme only while the site has that one page (so she can style a new site's first page, from a design for example; **Undo the last site theme change** reverts it). Once there are other pages, Kaity gives the page its own values over the shared theme, like *This page only*, and the other pages keep theirs. TYKERF offers its bundled fonts and fonts installed on the visitor's device: loading fonts from another server would send every visitor's IP address to that server. Choosing a bundled font copies its file into the page. To use another font in a site, register it in the site kit's **Fonts** with its files in the site's `assets/` ([Fonts](sites.md#the-site-kit)): every page declares it, and the theme can name it. A font field naming a font that is neither bundled nor registered gets a warning (Kaity's too): visitors without it see the next font in the list.

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
