<!-- tykerf:header -->
&nbsp;

[<img src="../../../src/editor/public/brand/tykerf-logo-docs.svg" alt="TYKERF" height="22">](../../../README.md) › [Documentation](../../README.md) › [User guide](README.md) › **Editing a page**
<!-- /tykerf:header -->

# Editing a page

Open a page from the site manager's **Overview** (by default http://localhost:4400), or from **Pages** in the side panel on the left. Every screen of TYKERF has the same frame: one bar on top and one panel on the left. On a page, the page takes all the rest of the width: nothing about it is docked on its right. Everything about the page is in the side panel, and a one-line box to ask Kaity sits under the page. TYKERF never draws inside the page or changes its look.

![A page in the editor: the top bar, the side panel with the page's tasks, Kaity on this page and its blocks, the task box on a link, and the box to ask Kaity under the page](../images/editor.png)

## The frame

- **The top bar**, on every screen: *Your site / <the page>* (a click on *Your site* goes back to the Overview); in the middle, **Tasks · Edit · View**, **?** (what you do in that mode) and the page's width; then **This page ▾** with how many tasks it has, **Kaity** (it opens [the Kaity center](ai.md#the-kaity-center); its count is what waits for you, when something does, else how many things she did), **Checks** (how many things the site's check found, *all good*, *not checked yet* or *out of date*), one **Undo** (point at it to see which step it takes back) and one **Publish**.
- **The three modes look the same:** the page sits in one box, its border in the mode's colour, with the mode's name on it: **Tasks** orange, **Edit** blue, **View** green. Nothing else stands between the top bar and the page. The first time you open each mode, a short note under its button says what you do there; **Got it** puts it away for good, and **?** shows it again.
- **The page's width:** **Desktop** (the room the page has), **768** (a tablet held upright) or **375** (a phone), in all three modes. The page lays out again at that width, shown smaller when it doesn't fit, and a task you write then remembers it. Escape goes back to Desktop.
- **The side panel on the left** is the page's: **← Site** (back to the Overview), the page's name, *Home* when it is the home page, and its address; then its sections, each opening and closing with a click: **Tasks on this page** (its open tasks, with **Give them to Kaity** and **Do it myself**), **Kaity on this page** (what she did here, newest at the bottom; see [what waits for you](#what-waits-for-you)), **Blocks** (every block of the page, the containers too, each folding; a click shows the block and aims the box under the page at it) and **Site** (the site's pages with **+ New page**, its screens, the Kaity center, the docs). TYKERF remembers which sections you leave open, and whether the panel is folded.
- **Folded** (the button at its top right), the panel is a narrow strip of icons: open it again, the tasks (with their count), Kaity, the blocks, and back to the site. The page then takes the whole width, and **This page ▾** in the top bar drops the same sections; **Pin to the side panel** opens the panel again. With the panel open, **This page** goes to its Tasks section. On a phone the panel sits above the page, folded.
- **Under the page**, in Tasks and in Edit, **the Kaity line**, the same as at the bottom of the site's screens; it grows while you write. The drop-down beside it says what Kaity may change: **This page** (any block of this page, nothing on other pages) or **Whole site**. One box is asked in its task box instead (*Ask Kaity now*, below); while a task box is open, the line is dimmed and can't be used, so there is one place to write at a time. The clip attaches pictures, PDFs or a design as a ZIP file (you can also drop or paste them on the line). **Enter** sends; **Shift+Enter** starts a new line. While Kaity works on anything, the line says on what and **Ask** waits.
- **Above the page**, a line appears only while something is going on: Kaity at work, what of hers waits for you, a page being built, fixing by hand, the tray open.

## Tasks

Leaving tasks for Kaity is the normal way to work. A task is something to be done, left on the exact place on the page it is about: a change to make, or a question.

- **Click anything on the page.** The element under the pointer is outlined in orange; a click opens the task box by it. Its top line says *New task* (it gets its number when you add it), the box it is in (point at it: Kaity changes only that box) and the element in words (*the button "Get started free"*); at a tablet's or a phone's width, that width too; **×** (or Esc) cancels. Write what should change and press **Add task** (⌘↵ / Ctrl+↵), for later. **Ask Kaity now** sends it to her at once instead, on that box only, with the element you pointed at; no task is left. A block picked in the side panel's *Blocks* opens its task box too. **Attach** (or a paste or drop on the box) sends up to five pictures or PDFs with the task: a screenshot, a sketch, a design to follow. For anything else, **More…** at the bottom left of the box (or a right-click on the page) opens the menu: fixing it by hand, editing its words, adding or deleting boxes. Nothing on the page reacts to clicks: links don't go anywhere, buttons don't press.
- **A question:** end what you write with `?` and *New task* turns into **Question**; a click on it switches between task and question. Right-click → *Ask a question here…* opens the box as a question. Kaity answers a question and changes nothing.
- Each open task leaves a **numbered pin** on its element (a question shows `?`). A pin opens the tray on its task.
- **The tray** (*See them all*, or a task, in *Tasks on this page*; or a pin) lists every open task and question as a card: *Show on the page*, *Mark done* and *Remove*. *Copy all for another agent* copies them as text, for any AI agent or a message; *Open the handbook* opens [the handbook](#the-handbook).
- A task remembers **how wide the window was** when you wrote it, so whoever does it looks at the page at that width ("too big on a phone").
- Tasks aren't part of the page and don't go with an export, but adding, changing, closing or removing one is a step: **Undo** takes it back like any other change. They follow a block when it is renamed; a task whose block was deleted says so.

![The tray over the page: two tasks and a question as cards, each with its box, its element and what to do about it](../images/tasks.png)

[![Watch two tasks given to Kaity on a page about London (1:40)](../../media/tykerf-tasks.jpg)](https://eonity.org/tykerf-guides/videos/tykerf-tasks.mp4)

## Kaity at work

**Give them to Kaity** hands over every open task on the page. She takes them **one at a time**, and on each she changes **only the box the task points at**; questions come last. While she works:

- The line above the page says *Kaity is working · task 2 of 3*, with the task she is on, and **Stop Kaity**, **Undo all she did** and *Hide the steps*.
- The tray shows each task: **done** with what she changed, in a sentence; **now** with what she is doing; **waiting**, which *Take it off her list* skips. When she finishes, it closes.
- On the page, her element is outlined with *2 · Kaity is here*, and the page scrolls to it (scroll yourself, and it stops following for a few seconds). Finished tasks' pins read *1 done*.

You can keep leaving tasks meanwhile, and *Ask for more* on a finished one: they join the end of her list.

## What waits for you

When she finishes, what she did is in **Kaity on this page** (and in the Kaity center), each item saying how it came out. The line above the page says how many things wait for you, with **Review**, which opens that section. Only a change gets a ✓:

- **Needs review**: she changed something. **Keep** keeps it; **Undo** takes back only that task's work, wherever it is in the history (Undo brings it back). On the item too: a way to check it that fits it (*See it on a phone* shows the page 375 px wide; *Try the button* or *Try the link* lets the page react until **Done trying**), **Before and after** (pictures of the box before she started and after), and *See her conversation on …*.
- **Kaity asks**: she needs something only you know (a price, a name, which of two options). Write the answer under her question and **Answer and continue**: she goes on.
- **Couldn't do it**: she couldn't do it where she was asked (a box can't change a shared block, or what is around it). Nothing changed and the task stays open. **Widen to this page** asks her the same on the whole page, in one click.
- **Asks first**: the change needs a shared block, which other pages show too. Nothing changed yet; the item names those pages, and **Change it on the 2 pages** lets her.
- **Answered**: her answer to a question. When it points at something you can do in one click, the item has it as a button: **Share hero with every page** (the box becomes one of the site's shared blocks, as on *Shared blocks*), **Open hero** (to fix it by hand) or **Go to about**.
- When she **left something unfinished** (sample text, a placeholder picture, a link that goes nowhere), the item lists it: **Fix them** has her finish it as part of the task; **Leave them as they are** keeps it.

The page's card on the Overview and the top bar's **Kaity** count what waits for you. Kept or not, everything she did stays a normal change, which Undo takes back step by step.

![Kaity done: the line above the page says what waits; Kaity on this page shows a change to review with Keep and Undo, a request she couldn't do with Widen to this page, and one that asks first](../images/review.png)

## Fixing one thing by hand

When it is quicker to do it yourself, right-click the element and choose **Fix it by hand** (or **Do it myself** in *Tasks on this page*): it opens in the side panel, beside the page, with **only that element**: a button's or link's words and where it leads (nowhere yet, a box of this page, a page of the site, or another address), a heading's or paragraph's words, a picture's description and *Choose another picture…*. **Save** writes it into the box; **Revert** puts back what is there. One line says whether the box is the same on another page (the fix stays on this one unless you share the box) or is a shared block (the fix reaches every page that shows it).

While it is open, a click on the page picks the next thing to fix, and the line above the page says *Fixing by hand · …* with **Done, back to tasks**. **More, if the fix is bigger** opens [the full editor](#the-full-editor) on the box, at the tab for it: its size and look, all its text, its code, or the box itself to move, add or delete boxes. *Too much to fix by hand?* leaves it as a task for Kaity instead.

![Fixing a link by hand: its text and where it leads, in the side panel; the link outlined on the page](../images/fix.png)

## The second button

**Right-click** anything on the page for what can be done there:

- *Leave a task here…*, *Ask a question here…* and *Fix it by hand*;
- *Edit this text*, for a heading, a paragraph, a link or a button that holds only words: type the new words right on the page; **Enter** keeps them, **Esc** puts them back. **Double-click** the words does the same, as in the full editor;
- *Add a box below…* or *Add a box beside…*: a new empty box, and the task box opens on it to say what should go there (Kaity fills it), or leave it empty;
- *Delete this box…*, asked first: its code goes into the box before it;
- *Open … in the full editor*, for everything else (renaming, sizes, code, moving boxes), and *View the site as visitors see it*.

Each of these is one step that **Undo** takes back.

## View mode

**View**, in the top bar (or **Alt+Shift+T**, and again to go back to Tasks), shows the page as a visitor sees it, in the same box with a green border: links, buttons and forms work, and nothing you click changes it. The side panel and the box to ask Kaity are put away, and the widths work as in the other modes. A link to another page of the site opens that page, still in View; a link to another site opens in a new tab. **View site** on the Overview, and *View* on each page's card, open it too.

**Open in a new tab**, on the border beside *View*, shows the page on its own, with nothing of TYKERF but a small pill at the bottom: *Viewing*, the page's name (it lists the site's pages, and *Back to the site manager*) and **Edit this page**. That tab stays like that while you follow links, until **Edit this page**.

## The full editor

The full editor is the expert way, beside tasks, for long manual work: restructuring a page, editing many boxes in a row, code, the page's theme. Each block's text, code, sizes and look are there by hand. **Edit**, next to **Tasks** in the top bar, switches to it (on the box you are fixing, when you are), and so do a right-click's *Open … in the full editor* and the quick fix's *More*. The full editor floats over the page in one box, as it always has: its header (the path of the selected block, Dim/Blur, **Compact**), the page's tree, and the selected block's actions (add a box beside or below, move it, rename, share, delete) and its Text, Code and Size & look tabs. Drag it by its header anywhere and resize it from its corner; TYKERF remembers where it is and how big. **Compact** shrinks it to its header. The page keeps the rest of the width, and the top bar's widths work here too: at 768 or 375 the page shrinks, the editor doesn't. The side panel's **Blocks** section shows the same tree, and a click there selects the block in the editor too. **Tasks** comes back, and every page opens in Tasks. Kaity is asked with tasks there too: right-click → *Add a task for Kaity here…*. The rest of this page describes it.

![Edit mode: the full editor floating over the page, with the tree, the hero's actions and its Text tab; the page's blocks in the side panel](../images/full-editor.png)

### Selecting

- **Click** a box on the page, or a line in the tree, to select it.
- **Esc** selects the container one level up. The path at the top of the panel (`page / intro / header / title`) is clickable too.
- **Right-click** a box on the page for its tools. Small ones happen right there: *Edit this text*, *Edit image…*, *Rename…* and *Delete…* open next to the pointer; *Edit code* and *Sizes…* open the panel; *Add a task for Kaity here…* leaves a task on the element, and *Add and give it to Kaity* takes you to Tasks, where she works on it.
- **Double-click** text or an image to edit it in place (see below).
- Everything outside the selection is **dimmed** or **blurred** (*Dim/Blur* in the panel header; Blur suits colourful sites). The selected block keeps its colours inside a dashed amber frame.
- The box under the mouse gets a moving outline and its name.
- While editing, the page is for pointing: links, buttons and forms don't react. Press **Back to the page** to use it normally.
- **⌘Z** (Ctrl+Z) undoes the last change, whoever made it, you or Kaity. **⇧⌘Z** (Ctrl+Y), or the arrow next to *Undo*, redoes it. Redo works until you make a new change. The last 200 steps can be undone; older ones stay listed in `.history-archive.jsonl`.
- **Box scripts run here** with the editor's own access, so open only pages whose code you trust (see [SECURITY.md](../../../SECURITY.md)).

### The panel

In TYKERF it floats over the page. Its header holds the path of the selected block, Dim/Blur, Compact and ×; the selected block's name is underlined in amber, the colour of the task box and of the frame round the block. Undo is the top bar's. Drag it by its header, resize it from its corner, **Compact** makes it small, **×** goes back to Tasks. Opened on its own (`/<page>/?tykerf=full-frame`), it has its own Undo and Redo too.

| Zone | What it shows |
|---|---|
| Header | Only what belongs to editing: the path of the selected block and Dim/Blur. The pages, the site, Undo, export and Kaity are in the frame and [the site's screens](sites.md#the-site-manager) |
| Tree | The whole page. **Boxes** (a small square) hold code; **containers** hold blocks. A container's icon shows its cut: a vertical line for blocks side by side (a *row*), a horizontal line for stacked blocks (a *column*). Hover a line to see the block on the page |
| Work area | Everything for the selected block. Each block keeps its own tab and unsaved drafts |

### Actions

- **Add beside / Add below:** a new empty box next to the selection. It joins the parent if the parent already runs that way; otherwise the selection is wrapped in a new row or column.
- **Add inside, Make row / Make column, Ungroup** (containers).
- **Up / Down** (or **Left / Right**): move the block among its neighbours.
- **Rename**, or click the name: every reference follows, and so does the block's conversation with Kaity.
- **Paste…**: put back code you removed (see below), into this box or as a new box beside, below or inside.
- **Delete…**: see below.
- **Share…** (a box in a site): make it a shared block that every page can show, or show one the site already has. A box that shows one is marked **shared** and offers **Make this page's own copy**; see [the site kit](sites.md#the-site-kit).

### Editing in place

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

### Tabs

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

An empty box's Text tab offers **Use a component** (ready-made sections with placeholders), **Import a section** (a part of another website, see [copying a website](importing.md)), **Write code** and **Leave a task for Kaity**. *Import a section…* is also in the right-click menu of every box.
- **Kaity:** tasks, from Tasks or a right-click; see [Working with Kaity](ai.md).

## The handbook

*Open the handbook* in the tray (or *Handbook* at the top of the full editor's **Page** tab) opens the page's system on one page, in a tab of its own: the theme (colours as swatches, fonts as samples, sizes and spacing as bars) and every block in page order, with chips to copy its name, its path or its link (`#sw-<name>`) into a request, and its tasks: the open ones, then the ones that are done with their reply, a record of what was decided. It is made from the page as it is now, so it is never out of date. **Markdown** downloads the same as text, for an AI agent or a colleague.

### Delete or Remove

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
