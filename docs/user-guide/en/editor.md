<!-- tykerf:header -->
&nbsp;

[<img src="../../../src/editor/public/brand/tykerf-logo-docs.svg" alt="TYKERF" height="22">](../../../README.md) › [Documentation](../../README.md) › [User guide](README.md) › **Editing a page**
<!-- /tykerf:header -->

# Editing a page

Open the page in the browser (by default http://localhost:4400) and press **Edit with TYKERF** in the bottom right corner. The page stays the real page, exactly as it renders; TYKERF draws its panel and frames on top of it and never changes the site's look.

![A page in the editor: the panel with the page's tree, a box selected and its Text tab](../images/editor.png)

## Two modes: Tasks and Edit

The switch at the top left of the panel picks how you work. TYKERF remembers your choice.

- **Tasks** (where you start): point at anything on the page and say what should change. Each task stays on its spot (see [Tasks](#tasks)). The panel shows only your tasks and what Kaity is doing. When you have them all, **Give Kaity every task**: she works through them, you watch her at work on the page, and her answer appears at the top of the panel when she's done. **Tabs** shows or hides the tasks' tabs on the page, **Copy all** copies them as text, and Undo and Redo are there too.
- **Edit**: the whole editor, described below: the page's blocks in a tree, each block's text, code, sizes and look, and Kaity block by block. Tasks still show on the page, and right-click → *Add a task for Kaity here…* adds one.

A link that opens a particular block (from the site manager, say) opens the Edit mode. After Kaity builds a new page, the Tasks mode shows her answer, ready for your first tasks.

## Selecting

- **Click** a box on the page, or a line in the tree, to select it.
- **Esc** selects the container one level up. The path at the top of the panel (`page / intro / header / title`) is clickable too.
- **Right-click** a box on the page for its tools. Small ones happen right there: *Edit this text*, *Edit image…*, *Rename…* and *Delete…* open next to the pointer; *Edit code*, *Ask Kaity here…* and *Sizes…* open the panel.
- **Double-click** text or an image to edit it in place (see below).
- Everything outside the selection is **dimmed** or **blurred** (*Dim/Blur* in the panel header; Blur suits colourful sites). The selected block keeps its colours inside a dashed amber frame.
- The box under the mouse gets a moving outline and its name.
- While editing, the page is for pointing: links, buttons and forms don't react. Press **Back to the page** to use it normally.
- **⌘Z** (Ctrl+Z) undoes the last change, whoever made it, you or Kaity. **⇧⌘Z** (Ctrl+Y), or the arrow next to *Undo*, redoes it. Redo works until you make a new change. The last 200 steps can be undone; older ones stay listed in `.history-archive.jsonl`.
- **Box scripts run here** with the editor's own access, so open only pages whose code you trust (see [SECURITY.md](../../../SECURITY.md)).

## The panel

Drag it by its header and resize it from its corner. **Compact** makes it small: in the Tasks mode it keeps a few lines of the tasks (what Kaity is doing, the button that gives her the tasks, the first ones); in the Edit mode only the header. **See more** opens it again, and so does choosing **Tasks** or **Edit**. **×** closes the editor, after asking; your tasks and changes stay, and *Edit with TYKERF* brings it back. On phones it docks at the bottom.

| Zone | What it shows |
|---|---|
| Header | The **Site** button (*Manage the site…*, *Export the site…*, *Export this page…*, *Kaity status…*). In a site, the current page: it lists the pages to switch to, with *Rename* and *Remove* on the current one, *All pages* (the [site manager](sites.md#the-site-manager)) and *New page…* at the end; the path of the selected block, Dim/Blur, Undo, Redo and collapse |
| Tree | The whole page. **Boxes** (a small square) hold code; **containers** hold blocks. A container's icon shows its cut: a vertical line for blocks side by side (a *row*), a horizontal line for stacked blocks (a *column*). Hover a line to see the block on the page |
| Work area | Everything for the selected block. Each block keeps its own tab, unsaved drafts and conversation with Kaity |

## Actions

- **Add beside / Add below:** a new empty box next to the selection. It joins the parent if the parent already runs that way; otherwise the selection is wrapped in a new row or column.
- **Add inside, Make row / Make column, Ungroup** (containers).
- **Up / Down** (or **Left / Right**): move the block among its neighbours.
- **Rename**, or click the name: every reference follows, and so does the block's conversation with Kaity.
- **Paste…**: put back code you removed (see below), into this box or as a new box beside, below or inside.
- **Delete…**: see below.
- **Share…** (a box in a site): make it a shared block that every page can show, or show one the site already has. A box that shows one is marked **shared** and offers **Make this page's own copy**; see [the site kit](sites.md#the-site-kit).

## Editing in place

**Text.** Double-click a heading, paragraph, button or list item. It becomes editable where it is, with a small toolbar above it.
- Type to change the words. **⌘B** bold, **⌘I** italic, **⌘K** link (or the toolbar); in a site the link box lists the site's pages to pick from. **Shift+Enter** starts a new line.
- **Enter**, *Done* or a click elsewhere saves; **Esc** cancels. Each save is one undo step.
- Pasting adds the words only, without the formatting they had.
- Only words, bold, italic and links change this way, so the box's code stays clean: no styles or extra tags are added. Layout and structure are changed in the *Code* tab.
- Text next to other elements (an icon in a button, say), or text the box changes with a script, opens in the *Text* tab instead.

**Images.** Double-click an image (or right-click → *Edit image…*):
- **Replace** it: *Choose a file…*, drop one on the tool, or pick one the page already has (*From this page…*). PNG, JPEG, GIF, WebP and AVIF, up to 15 MB.
- **Crop** it: drag the frame, a corner, or an edge (an edge changes only the width or only the height). *Shape* keeps it free, as the original, as it shows on the page, or at 1:1, 4:3, 3:2 or 16:9.
- **Undo a crop later:** opening a cropped image shows the whole original with the crop on it. Drag the frame wider, or choose *Original*, and *Apply*. *Start over* goes back to the whole image, not turned, at its size.
- **Turn** it by a quarter, and limit its **largest side** (2400, 1600, 1200 or 800 px) so the page loads faster.
- Write its **image text** for people who can't see it.
- *Apply* saves the result as a new file in `assets/` (the original stays) and points the image at it: one undo step. PNG stays PNG; other photos are saved as JPEG. GIF and SVG images can be replaced but not cropped.
- **Its size on the page** comes from its box. With the **Image** component (a picture and a caption) the image fills its box, so the box handles size it: the right edge makes it narrower (centred), the handles between boxes side by side share the width, the bottom edge makes it taller (a taller box shows more of the picture, cut to fit, never stretched). An image inside a larger section (a hero) is sized by that section's layout: change it in the *Code* tab, or ask Kaity.
- An image from another site (an imported page) can be copied into the page first with *Copy into the page*, so the page stops loading it from there.

## Tabs

- **Text** (boxes): the box's words, link targets, image addresses and image descriptions as plain fields. The markup stays as it was.
- **Code** (boxes): *Content* (markup and scripts), *Style* (CSS that only applies to this box) or *Full code*. ⌘S saves.
- **Size & look:**
  - **Look**, at the top:
    - **Band:** *None*, *Alternate* (a shade of the background), *Soft* (a wash of the accent) or *Dark* (its text turns light).
    - **Density:** *Normal* or *Dense* (less space around it, smaller titles).

    - **Site tags**, in a site whose kit has them: the site's own tags, on or off (see [the site kit](sites.md#the-site-kit)).

    The theme gives the colours, so a band always matches the page. It works on any block: a box, whatever its code, or a whole container. Each change is one undo step.
  - **Widths** of blocks side by side, with *Equal widths*. Handles also sit on the page between the blocks.
  - **Width** of the selected block when it isn't side by side with others: narrower than the space it has, and centred. The handle on its right edge does the same on the page; double-click it, or press *full*, to make it full width again.
  - **Heights** of stacked blocks, as a minimum height. A block can be made taller, never shorter than its content. Double-click a height handle, or press *auto*, to go back to the content's height.
  - The page previews while you drag; the change is saved, as one undo step, when you let go.
- **Blocks** (containers): the blocks inside, in order, each with its band and density when it has them (*Soft band*, *Dark band*, *Dense*…).
- **Page** (the top block): the theme (colours, fonts, spacing) and the page's head code. See [layouts, components and the theme](layouts.md).

An empty box's Text tab offers **Use a component** (ready-made sections with placeholders), **Import a section** (a part of another website, see [copying a website](importing.md)), **Write code** and **Ask Kaity**. *Import a section…* is also in the right-click menu of every box.
- **Kaity:** see [Working with Kaity](ai.md).

## Tasks

A task is something to be done, left on the exact place on the page it is about: a change to make, a question, something to check. It is for you, a colleague or Kaity.

- In the **Tasks** mode, the element under the pointer is outlined, with its place in words (`hero › h1 "The short promise…"`). Click it, write the task and press **Enter** (or **Add task**). Nothing else happens on the page in this mode; **Edit** goes back to the whole editor.
- In the **Edit** mode: right-click anything and choose *Add a task for Kaity here…*. The same form opens on the element you clicked, with **Add task** (for later) and **Add and give it to Kaity** (Kaity works on the block's open tasks at once; **Enter** does this).
- Each open task shows as a **numbered tab** (`T3`) on its element's top-right corner, which follows it when the page changes. The header shows how many are open. Click a tab to read the task: **Done** closes it, **Remove** deletes it, **Give it to Kaity** hands every open task on that block to Kaity.
- **While Kaity works**, her block glows on the page with a light sweeping across it, each task she still has to do pulses, and a small label shows what she's doing right now. The page follows her: when she moves to a block out of sight, it scrolls there, and on a run over the whole page her frame and label move to the block she's on. Scroll yourself and it stops following for a few seconds, so it never pulls the page away from you. Her conversation shows the tasks she was given, word for word. You can keep adding tasks meanwhile, on her block too: they don't change what she's doing, she leaves them for the next request, and only the tasks she was given pulse.
- A task remembers **how wide the window was** when you wrote it, so whoever does it looks at the page at that width ("too big on a phone").
- The Tasks mode's panel lists every task by block: **Give Kaity every task** for one run over the whole page, *Give only these to Kaity* for one block's tasks, and the tasks that are done, with Kaity's reply. Click a task to see it on the page. In the header, **Tabs** shows or hides the tabs and **Copy all** copies the open tasks as text to paste into any AI agent or a message.
- Tasks aren't part of the page: they aren't undone with Undo, and they don't go with an export. They follow a block when it is renamed; a task whose block was deleted says so.

## The handbook

*Handbook* at the top of the **Page** tab opens the page's system on one page, in a tab of its own: the theme (colours as swatches, fonts as samples, sizes and spacing as bars) and every block in page order, with chips to copy its name, its path or its link (`#sw-<name>`) into a request, and its tasks: the open ones, then the ones that are done with their reply, a record of what was decided. It is made from the page as it is now, so it is never out of date. **Markdown** downloads the same as text, for an AI agent or a colleague.

## Delete or Remove

Taking a block out asks what should happen to its code:

- **Delete:** the code moves to the end of the **previous box** in reading order (or the next box, if it was the first). Nothing is lost and the page still shows it.
- **Remove:** the code goes to the **buffer** and leaves the page. *Paste…* puts it back anywhere. The buffer keeps the last 20 items.

For a container, the code of all its boxes goes together, in reading order. Both are one undo step.

## Not yet

Blocks can't be dragged to new places (use Up/Down and Kaity), and wheel layouts are shown as plain containers. Images that are no longer used stay in `assets/` (so undo can bring them back) until you clean them up in the top block's **Page** tab: *Unused files* lists those that no box, the head, the paste buffer or an undo step uses, and *Move them to the trash* puts them in the page's `.trash/` folder.

<!-- tykerf:footer -->
---

← [Getting started](getting-started.md) · [User guide index](README.md) · [Working with Kaity](ai.md) →

[TYKERF](../../../README.md) · [Documentation](../../README.md) · [GitHub](https://github.com/eonity-org/tykerf) · Apache-2.0 · an [eonity](https://eonity.org) project
<!-- /tykerf:footer -->
