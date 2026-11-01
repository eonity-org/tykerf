<!-- tykerf:header -->
&nbsp;

[<img src="../../../src/editor/public/brand/tykerf-logo-docs.svg" alt="TYKERF" height="22">](../../../README.md) › [Documentation](../../README.md) › [User guide](README.md) › **Why TYKERF**
<!-- /tykerf:header -->

# Why TYKERF

TYKERF is a web page editor for people and AI working together. What sets it apart: **its assistant, Kaity, changes one clearly named block at a time, and nothing else.**

## The problem

When an AI changes a website it usually rewrites HTML and CSS, and you hope nothing else broke. Ask it to fix the pricing table and the footer shifts, a colour changes somewhere else, or a section quietly disappears. Undoing that means reading code or starting over.

Website builders give you a friendlier editor, with AI added on top. But that AI still has no clear idea of where one part of the page ends and the next begins.

## What TYKERF does differently

**Every page is a tree of named blocks.** TYKERF cuts a page into rows and columns, and those into smaller ones, down to boxes of ordinary HTML. This is the slicing method used to lay out microchips. Every block has a name, such as `hero`, `pricing` or `footer`, so you and Kaity talk about the same thing.

**Changes are moves, not rewrites.** Adding a box beside another, making a row, resizing, renaming: each change is a named, checked move on the tree. A move either leaves the page valid or is refused, so the layout can't end up broken.

**Kaity works inside one block.** Select a block and ask. Kaity can change that block and what is inside it. TYKERF checks every change she tries, and refuses anything outside the block; it doesn't just ask the model nicely. Kaity has no file or shell access: she can only use TYKERF's moves.

**Everything can be undone.** Every change, yours or Kaity's, is a step in one history, with who made it and when. Undo goes back step by step, even in the middle of a long AI session.

**Kaity looks at her work.** She takes screenshots of the block at desktop and phone widths and checks the layout, then fixes what looks wrong before telling you she's done.

## See it

[![Watch Kaity build a page about Lisbon from one sentence (2:48)](../../media/tykerf-builds-lisbon.jpg)](https://eonity.org/tykerf-guides/videos/tykerf-builds-lisbon.mp4)

One sentence on the start screen, a two-minute build, then a page whose every part is a named block you can select, change and undo.

## What that gives you

- **Start fast, three ways:**
  - describe the page or show a picture, and Kaity builds it;
  - copy an existing website;
  - pick a layout.

  See [Getting started](getting-started.md).
- **Edit the real page.** TYKERF draws its panel over the page as it really renders. Double-click text to change it where it is, crop an image in place, drag a block narrower.
- **Point, say, hand over:** click anything on the page, write what should change ("make this shorter", "turn these three cards into a pricing table"), and give your tasks to Kaity. She works through them and answers each one. For exact control, the Edit mode gives you the whole editor, and each block keeps its own conversation with Kaity.
- **A modern look by default:**
  - light, modern layouts and themes;
  - every layout is checked for readable contrast and for working on phones.
- **One theme for the whole site.** Change colours or fonts once and every page follows.
- **Your AI, your choice:**
  - in the editor, Kaity runs on your own Claude Code, the Anthropic API or a compatible service, or Gemini;
  - Claude Code and Cowork through the TYKERF plugin, and Claude Desktop through a one-click extension;
  - any MCP client.

  TYKERF holds no key of its own on your computer.
- **Plain files, no lock-in:**
  - a page is a folder of plain text files: a one-line layout, one HTML file per box, a head file;
  - export gives you static HTML for any web host;
  - nothing depends on TYKERF to be served.
- **Private by design:**
  - fonts are bundled;
  - nothing is loaded from a CDN, while editing or after export;
  - the editor runs on your computer and only accepts requests from it.

## When TYKERF is not the right tool

- **Content management:** blogs with hundreds of posts, user accounts, shops. Use a CMS. TYKERF pages can link to them.
- **Pixel-perfect clones of other sites:** a copy is a starting point to edit, not an exact replica.
- **Apps:** TYKERF makes pages. Interactive widgets work inside a box, but TYKERF won't build your application's logic.

## Try it

Follow [Getting started](getting-started.md): install, start a site, and have a first page in a few minutes.

<!-- tykerf:footer -->
---

← [User guide](README.md) · [User guide index](README.md) · [Getting started](getting-started.md) →

[TYKERF](../../../README.md) · [Documentation](../../README.md) · [GitHub](https://github.com/eonity-org/tykerf) · Apache-2.0 · an [eonity](https://eonity.org) project
<!-- /tykerf:footer -->
