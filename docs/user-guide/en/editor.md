<!-- tykerf:header -->
&nbsp;

[<img src="../../../src/editor/public/brand/tykerf-logo-docs.svg" alt="TYKERF" height="22">](../../../README.md) › [Documentation](../../README.md) › [User guide](README.md) › **Editing a page**
<!-- /tykerf:header -->

# Editing a page

Open the page in the browser (by default http://localhost:4400) and press **Edit with TYKERF** in the bottom right corner. The page stays the real page, exactly as it renders; TYKERF draws its panel and frames on top of it and never changes the site's look.

![A page in the editor: the panel with the page's tree, a box selected and its Text tab](../images/editor.png)

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

Drag it by its header, resize it from its corner, collapse it with **–**. On phones it docks at the bottom.

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

    The theme gives the colours, so a band always matches the page. It works on any block: a box, whatever its code, or a whole container. Each change is one undo step.
  - **Widths** of blocks side by side, with *Equal widths*. Handles also sit on the page between the blocks.
  - **Width** of the selected block when it isn't side by side with others: narrower than the space it has, and centred. The handle on its right edge does the same on the page; double-click it, or press *full*, to make it full width again.
  - **Heights** of stacked blocks, as a minimum height. A block can be made taller, never shorter than its content. Double-click a height handle, or press *auto*, to go back to the content's height.
  - The page previews while you drag; the change is saved, as one undo step, when you let go.
- **Blocks** (containers): the blocks inside, in order, each with its band and density when it has them (*Soft band*, *Dark band*, *Dense*…).
- **Page** (the top block): the theme (colours, fonts, spacing) and the page's head code. See [layouts, components and the theme](layouts.md).

An empty box's Text tab offers **Use a component** (ready-made sections with placeholders), **Import a section** (a part of another website, see [copying a website](importing.md)), **Write code** and **Ask Kaity**. *Import a section…* is also in the right-click menu of every box.
- **Kaity:** see [Working with Kaity](ai.md).

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
