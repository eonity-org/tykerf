# TYKERF

Build and edit real web pages block by block. Claude reads a page as a tree of named blocks (rows, columns and boxes of HTML) and changes it through validated moves instead of rewriting the whole file: it splits, groups, moves and resizes blocks, writes one box's code, uses ready-made sections and themes, and looks at the result in screenshots at phone and desktop widths. Every change goes into the page's history and can be undone. The pages are plain HTML files in a folder on your computer, with no platform or account behind them.

TYKERF is open source (Apache-2.0): https://github.com/eonity-org/tykerf

## Start

Ask Claude for a page: "make a landing page for my bakery", or "change the pricing section of the page in ~/Sites/bakery".

- Claude opens a folder first and tells you which one. Without a folder named, it uses the default folder: the plugin's **Default page folder** setting (Claude Code), else `TYKERF_DIR`, else `~/TYKERF`.
- An empty or new folder becomes a new page or a site of pages; an existing TYKERF page or site opens as it is. A folder that holds other files is refused, so TYKERF never writes among your own files.
- Ask Claude to focus on one block ("only the header") to keep every other part of the page safe: changes outside it are refused.
- To see the page in your browser, with the TYKERF editor over it, run TYKERF from its repository (`npm start -- <folder>`), or export it as plain files for any web host.

## What it needs

- **Claude Code**, or **Cowork** in the Claude desktop app when the session runs on your computer. Chat on claude.ai doesn't run local servers, so the plugin does nothing there.
- **Node.js 20 or later** on your computer (`node` on the PATH): the plugin's server is a Node.js program. Claude Code installs its one package, Playwright, with npm when it installs the plugin.
- **Chromium for screenshots and page checks**: run `npx playwright install chromium` once. Every other tool works without it.

## Privacy policy

TYKERF's server runs on your computer and works only on the page folder Claude opens.

- **What it collects:** nothing. It has no account, no key, no analytics and no telemetry, and it calls no API. Claude does the thinking, with your Claude account, under Anthropic's own terms.
- **How data is used and stored:** the server reads and writes the page's files in the folder you open (`layout.slice`, `boxes/`, `head.html`, `assets/`) and keeps the page's history there (`.history.jsonl`), so every change can be undone. Nothing is stored anywhere else.
- **Sharing with third parties:** none. The server sends nothing over the network. Screenshots and checks render the page in Chromium on your computer; if a page's own code loads files from other servers (a copied website can), Chromium fetches them as any browser would.
- **Retention:** the files and their history stay in the page folder until you delete them. Deleting the folder removes everything TYKERF wrote.
- **Contact:** dev@eonity.org, or an issue at https://github.com/eonity-org/tykerf/issues.

## More

- User guide: https://github.com/eonity-org/tykerf/blob/main/docs/user-guide/README.md
- Report a problem: https://github.com/eonity-org/tykerf/issues
- TYKERF is an eonity project. Licensed under the Apache License 2.0; see LICENSE and NOTICE.
