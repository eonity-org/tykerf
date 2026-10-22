# Copying a website

TYKERF can start a page from any website, or copy one section of a website into a box. It loads the site in a browser, cuts the rendered page into rows, columns and boxes (the XY-cut method), and turns the result into TYKERF blocks you can edit like any other.

## A new page from a website

On the start screen of a new site, or with **New page…** in the page switcher, choose **A copy of a website**, write the page's address and choose **Copy the page**. TYKERF names the page after the site until you give it a name yourself. The page opens at once, with a window that follows the copy step by step (a few seconds to a minute); the **×** stops it and removes the unfinished page. When it is done, choose **Open the editor** or **See the page**.

**Only the layout** keeps the blocks but leaves out the site's text, images and styles, for when you only want its structure.

From the command line:

```bash
npm run cli -- import https://example.com my-copy [--structure-only]
npm start -- my-copy
```

## A section of a website in a box

Right-click a box and choose **Import a section…** (an empty box also offers it in its Text tab). Write the address of the page and choose **Copy the page**: TYKERF copies it and shows its sections (the header, each band of the page, the footer) with a picture of each. Choose one, and it takes the place of the box:

- The box keeps its name, so the conversation with Kaity and the selection stay with it. If the section has several parts, the box becomes a row or column holding them.
- The section's responsive rules come along, and its styles go into the page head as a marked block, so they apply to that section only. The page's own theme and the other blocks are not touched.
- It is one undo step: Undo puts the box back as it was, with its code.

The copy is kept until you copy another page, so you can import several sections of the same page one after another.

## What you get

- One box per section, with the site's HTML and its styles at desktop width, plus the changes at the site's own breakpoints and at phone width.
- Rows that stack on small screens become responsive rules; things that disappear become *hide* rules.
- Fonts and section styles the page needs go into `head.html`. The fonts' files and the images come into the page's `assets/` folder (fonts named after their family, such as `font-manrope-….woff2`).
- Blocks the site centres stay centred at every width, and CSS animations keep playing.

The copy is a starting point, not a pixel-perfect clone: check it at desktop and phone widths, and expect to tidy some boxes with the editor or Kaity. Scripts that depend on the original site (logins, carts, analytics, menus that open) won't work in the copy.

## What you may do with the copy

A copy includes the site's text, images and design, which usually belong to someone else. TYKERF shows this advice before anything is copied.

- **Your own site:** rebuild it, restructure it, publish it.
- **Someone else's site:** fine for studying a layout, prototyping or a private mock-up. Don't publish it, or anything that still contains their text, images, logos or design, without the owner's permission.
- The site's images and fonts are copied into the page's `assets/` folder, so the copy loads nothing from the original servers. Anything that couldn't be downloaded stays linked, and the [export](exporting.md) lists it. Being on your computer doesn't make them yours: replace the ones you may not use before publishing.
