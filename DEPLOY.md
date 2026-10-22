<!-- tykerf:header -->
&nbsp;

[<img src="src/editor/public/brand/tykerf-logo.svg" alt="TYKERF" height="20" style="border-radius:0">](README.md) › **Deploying**
<!-- /tykerf:header -->

# Deploying

TYKERF has two parts with very different deployment stories:

- **The pages you make** are plain static HTML. Publish them anywhere.
- **The editor and the MCP server** are local tools. They edit files on disk and can run Claude Code on your account, so they are meant to run on your own machine, not on a public server.

## 1. Publish a page

Render the workspace:

```bash
npm run cli -- render path/to/workspace     # writes path/to/workspace/out/index.html
```

`out/index.html` is a single, self-contained file: the layout CSS, every box's HTML, its scoped `<style>` and its `<script>`, and the workspace's `head.html`. It contains nothing from the editor: no panel, no `/_tykerf/` requests, no fonts or scripts that TYKERF adds.

If the page uses images from its `assets/` folder, rendering copies them to `out/assets/`: upload the whole `out/` folder.

Upload it to any static host: GitHub Pages, Netlify, Cloudflare Pages, an S3 bucket, or a plain web server.

**Check before publishing:**
- **Assets.** Images, videos and files that your boxes reference keep the paths you wrote. Absolute URLs work as they are; relative paths (`images/hero.webp`) need those files uploaded next to `index.html`.
- **Third-party requests.** TYKERF adds none, but your own box code or `head.html` may load fonts, scripts or images from other domains. Under the GDPR each of those requests discloses the visitor's IP address, so host them yourself where you can.
- **Phone and desktop.** Open the page at 375 px and 1440 px, or run the metrics:
  ```bash
  npm run metrics -- path/to/workspace/out/index.html --shots path/to/workspace/out
  ```

### Automating it

`out/` is in `.gitignore`. To publish from CI, keep the workspace in git and render in the pipeline, for example with GitHub Actions:

```yaml
name: Publish page
on:
  push:
    branches: [main]
permissions:
  pages: write
  id-token: write
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: github-pages
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm run cli -- render site            # your workspace folder
      - uses: actions/upload-pages-artifact@v3
        with:
          path: site/out
      - uses: actions/deploy-pages@v4
```

Rendering doesn't need a browser, so CI doesn't need `npx playwright install`.

### Publish a site to GitHub, Cloudflare Pages or Netlify

The site manager's **Publish** sends the whole site, exported, to a GitHub repository as one commit, with no git needed on your machine. Whatever is connected to that repository puts it live.

1. **Make a repository** on GitHub, or use the one you already have. Public for GitHub Pages on a free account; Cloudflare Pages and Netlify also take a private one. An empty repository is fine: the first publish starts it with a README on its default branch.
2. **Make a token:** on GitHub, *Settings → Developer settings → Personal access tokens → Fine-grained tokens* (or straight to <https://github.com/settings/personal-access-tokens/new>). Give it access to that repository only, with *Contents: read and write*. Put it in TYKERF's `.env` (never inside the site folder, which may be that repository) and restart TYKERF:
   ```bash
   TYKERF_GITHUB_TOKEN=github_pat_...
   ```
3. **Say where:** in the site manager, **Publish**. Fill in the repository (`you/your-site`), the branch (`gh-pages`, or `main`), a folder if the site shouldn't be at the top of the branch (`docs`), and the site's address (`https://you.github.io/your-site`, for `sitemap.xml`). Then **Publish**.
4. **Connect the host once:**
   - **GitHub Pages:** the repository's *Settings → Pages → Deploy from a branch*, with the branch and folder above (GitHub Pages offers only the top or `/docs`).
   - **Cloudflare Workers:** *Workers & Pages → Create → Import a repository*, with the repository. In the build settings, the branch above, no build command, and as the deploy command `npx wrangler deploy --assets=. --name=<the worker's name> --compatibility-date=2026-10-01` (`--assets=docs` for a folder). Without `--assets`, wrangler stops with "Could not detect a directory containing static files".
   - **Cloudflare Pages:** *Workers & Pages → Create → Pages → Connect to Git*, with the repository and branch. Framework preset *None*, no build command, and the folder above as the output directory (empty for the top).
   - **Netlify:** *Add new site → Import an existing project*, with the repository and branch. No build command, and the folder above as the publish directory.

Each publish after that is one commit, and the host redeploys it within a minute or two. Only the files that changed are sent. TYKERF replaces and removes only what it published before (the list in `.tykerf-published.json`), so a `CNAME` for a custom domain, a README or anything else in the repository stays. To take a publish back, revert its commit on GitHub. Publishing waits while Kaity is working, so half a change never goes live.

## 2. Run the editor

```bash
npm start -- path/to/workspace [--port 4400]
```

The editor listens on `127.0.0.1` only and refuses requests from other sites (see [SECURITY.md](SECURITY.md)). It has **no login** unless you set `TYKERF_ADMIN_PASSWORD` (see [Serve a site to visitors](#serve-a-site-to-visitors-with-an-admin)): anyone who can reach it can change the page and, through the AI tab, use your Claude Code account.

**Do not expose it on the internet.** To use it on another machine:

- **SSH tunnel (recommended).** Run TYKERF on the remote machine as usual, then from your computer:
  ```bash
  ssh -L 4400:localhost:4400 user@remote-machine
  ```
  and open http://localhost:4400. The editor stays private to the remote machine; only you reach it, through SSH.
- **A trusted private network** (a VPN, or your own LAN): `npm start -- workspace --host 0.0.0.0`. Everyone on that network can edit and use the AI, so only do this when you trust all of them. The editor still refuses other host names, so reach it by IP address (`http://192.168.1.20:4400`), not by a DNS name.

**The AI tab** runs `claude` on the machine where the editor runs by default, so Claude Code must be installed and signed in there. With `TYKERF_RUNNER=anthropic` (the Anthropic API, or a compatible endpoint, with `TYKERF_API_KEY` and `TYKERF_API_BASE_URL`) or `TYKERF_RUNNER=gemini` (`GEMINI_API_KEY`), the editor calls the API itself with that key instead. Put the settings in a `.env` file (see `.env.example`), never in the repository. `TYKERF_MODEL` chooses the model. See [the AI guide](docs/user-guide/en/ai.md#which-ai-answers).

**Keep the workspace in git.** TYKERF records every change in `.history.jsonl` and can undo them, but git gives you review, branches and a backup. `.tykerf/` (AI conversations, attached images, the removed-code buffer) is per-person state and is ignored.

### Serve a site to visitors, with an admin

TYKERF can also serve a site itself: visitors get the pages as they are, and only you edit. In `.env`:

```bash
TYKERF_ADMIN_PASSWORD=a-long-passphrase      # turns sign-in on
TYKERF_PUBLIC_URL=https://cities.example.org  # the site's address: allowed as a host name and origin, and used for sitemap.xml
```

- **Visitors** get each page without the editor, its images and files, `/` (the home page set in the site manager, or the list of pages), `/pages/` and `/sitemap.xml`. Every editor address (`/_tykerf/…`) answers 401.
- **You** sign in at `/_tykerf/login` (the list of pages, `/pages/`, links to it: *Sign in to edit*, or *Site manager* once you're in); the session is a cookie (`HttpOnly`, `SameSite=Strict`, `Secure` over HTTPS) that lasts a week, or until TYKERF restarts. **Sign out** is in the site manager. After five wrong passwords from one address, it waits ten minutes.
- Run it behind a reverse proxy that does HTTPS and passes the `Host` header on (Caddy, nginx), with TYKERF on `127.0.0.1`. Write `TYKERF_PUBLIC_URL` with `https://`: the editor accepts changes only from that origin, and the sign-in cookie is then sent over HTTPS only. Caddy gets the certificate and sends `http://` visitors to `https://` by itself:
  ```
  cities.example.org {
    reverse_proxy 127.0.0.1:4400
  }
  ```
- There is one admin and one password; accounts come with TYKERF on Tydal (see the [roadmap](ROADMAP.md)).
- Without `TYKERF_ADMIN_PASSWORD`, everything above is off: TYKERF is the local editor, and anyone who reaches it edits.

## 3. Connect the MCP server to an AI client

The MCP server speaks stdio, so the client starts it on your machine. Use absolute paths.

Claude Code:

```bash
claude mcp add tykerf -- /path/to/tykerf/node_modules/.bin/tsx /path/to/tykerf/src/mcp/server.ts --dir /path/to/workspace
```

Clients that use a JSON config (for example Claude Desktop's `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "tykerf": {
      "command": "/path/to/tykerf/node_modules/.bin/tsx",
      "args": ["/path/to/tykerf/src/mcp/server.ts", "--dir", "/path/to/workspace"]
    }
  }
}
```

The `screenshot` and `evaluate` tools need Chromium (`npx playwright install chromium`). The editor and the MCP server can work on the same workspace at the same time: the editor picks up the AI's changes live. Each change takes a short lock on the folder (`.tykerf.lock`), so two processes never overwrite each other's changes; a lock left by a process that crashed is cleared after a few seconds.

## 4. Release a new version of TYKERF (maintainers)

1. `npm test && npm run typecheck`, and try the editor on `examples/widgets`.
2. Update `CHANGELOG.md` and the version in `package.json` (and the version the MCP server reports, in `createTykerfServer` in `src/mcp/tools.ts`).
3. If the notation changed, check that `docs/slicing-notation.md` matches.
4. Commit, check that CI passes, tag `v<version>`, push the tag, and create a GitHub release with the changelog section as its notes. The release workflow then builds `tykerf.mcpb` and attaches it to the release.

TYKERF is not published to npm; people install it from the repository.

<!-- tykerf:footer -->
---

[TYKERF](README.md) · [Documentation](docs/README.md) · [GitHub](https://github.com/eonity-org/tykerf) · Apache-2.0 · an [eonity](https://eonity.org) project
<!-- /tykerf:footer -->
