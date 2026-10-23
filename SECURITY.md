<!-- tykerf:header -->
&nbsp;

[<img src="src/editor/public/brand/tykerf-logo-docs.svg" alt="TYKERF" height="22">](README.md) › **Security**
<!-- /tykerf:header -->

# Security

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's **Report a vulnerability** button on the repository's Security tab (https://github.com/eonity-org/tykerf/security), not in a public issue. We'll acknowledge the report and keep you informed while we fix it.

## What TYKERF trusts

TYKERF is a local development tool. Know what it can do before you run it:

- **Serving a site to visitors** (`TYKERF_ADMIN_PASSWORD`, see [DEPLOY.md](DEPLOY.md#serve-a-site-to-visitors-with-an-admin)): visitors get only the pages, their files, the list of pages and the sitemap; every editor address needs the admin's session cookie. The password is compared in constant time, wrong ones slow down and lock one address for ten minutes after five. Sessions live in memory. There is a single admin; use a long passphrase and HTTPS. Behind an HTTPS proxy, changes are accepted from `TYKERF_PUBLIC_URL`'s origin and no other.
- **Publishing to GitHub** (`TYKERF_GITHUB_TOKEN`): the token stays on the server. The site manager only learns whether one is set, and it goes only to GitHub's API (`TYKERF_GITHUB_API`). Give it *Contents: read and write* on the site's repository and nothing else, and keep `.env` out of that repository. A publish replaces and removes only the files a previous publish wrote (the list in `.tykerf-published.json`).
- **The site's styles and scripts** (Styles & scripts in the site manager) go in the head of every page: a script there runs on every page, for visitors and in the editor, like a box script does.

- **The editor server edits the workspace folder** and, when you use the AI tab, **runs your Claude Code on your account**.
  - It listens on `127.0.0.1` only.
  - It refuses requests whose `Host` isn't `localhost`/`127.0.0.1` (against DNS rebinding).
  - It refuses changes from other origins or without a JSON body (against cross-site requests).
  - `--host <address>` exposes it to a network, where it is reached by IP address (host names are still refused). It has no login, so only do that on a network you trust: anyone who can reach it can edit the page and spend your AI usage. See [DEPLOY.md](DEPLOY.md).
- **Box code runs in your browser, with the editor's access.** A box is ordinary HTML with scripts, and the editor shows the real page, so box scripts run in the same page and origin as the editor panel. A box script can therefore do anything the panel can: change any block, edit `head.html`, undo, or start an AI run on any block. The editor's guards against other sites don't help here, because the request comes from the editor's own page. In particular:
  - **The AI scope doesn't cover the scripts the AI writes.** The AI can only change its block, but a `<script>` it puts in that block runs when you open the page in the editor, and anything it does there is recorded as yours.
  - **Look at scripts before you open a page in the editor**: in pages from other people, in imported code, and in AI changes you haven't reviewed (the box's *Code* tab, or `boxes/*.html`). Box types can forbid scripts (`"content": { "scripts": false }`), and the AI is then refused when it tries to add one.
  - Rendered pages (`out/`) contain no editor, so there the scripts are only part of the page.
- **API keys stay on the machine.** With `TYKERF_RUNNER=anthropic` or `gemini`, the editor reads the key from `.env` (ignored by git) or the environment, and sends it only to that API. It is never sent to the browser or written to the page. Anyone who can reach the editor can spend that key's usage, as with Claude Code.
- **The AI has no file or shell access.** It is started with `--tools ""` and only the TYKERF MCP tools. The selected block is its scope for that run, passed to the MCP server for that run only. Moves and code changes outside it are refused by the workspace layer, and if the block disappears every change is refused. While the AI works, the editor can't change that block either.
- **The importer** (`npm run cli -- import <url>`) loads the given site in a headless browser.

<!-- tykerf:footer -->
---

[TYKERF](README.md) · [Documentation](docs/README.md) · [GitHub](https://github.com/eonity-org/tykerf) · Apache-2.0 · an [eonity](https://eonity.org) project
<!-- /tykerf:footer -->
