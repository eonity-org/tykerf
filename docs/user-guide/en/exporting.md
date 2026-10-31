<!-- tykerf:header -->
&nbsp;

[<img src="../../../src/editor/public/brand/tykerf-logo-docs.svg" alt="TYKERF" height="22">](../../../README.md) › [Documentation](../../README.md) › [User guide](README.md) › **Exporting a page or a site**
<!-- /tykerf:header -->

# Exporting a page or a site

An export is the page, or every page of the site, as plain files you can put on any web host: HTML, the page's images and other files from `assets/`, and nothing of TYKERF. The history, the conversations with Kaity, box types and TYKERF's script stay out.

## From the editor

Click the **Site** button (between the TYKERF logo and the page name) and choose **Export the site…** (**Export the page…** for a folder that is one page). TYKERF first shows what the export will hold: the number of pages, the size, links to pages that don't exist, and files still loaded from other servers. Then choose:

- **For a web server**: links between pages end in a folder (`../about/`), as web hosts serve them.
- **To open from disk**: links between pages end in `index.html` (`../about/index.html`), so you can double-click `index.html` and browse the export without a web server. It works on a web host too, with less tidy addresses.

The editor downloads a `.zip` named after the folder and the date. **Export the site…** holds every page, so links between pages keep working.

**Export this page…** (in a site) holds only the page you're on, with the site's theme and fonts, in a `.zip` named after the page. Its links to other pages of the site are listed before you download: they lead nowhere until those pages are next to it.

## Publishing instead

To put the site online without downloading anything, **Publish** in the site manager sends it to a GitHub repository that GitHub Pages, Cloudflare Pages or Netlify serve: see [Publishing and serving](publishing.md).

## From the command line

```bash
npm run cli -- export my-site export/              # a folder
npm run cli -- export my-site my-site.zip          # a zip
npm run cli -- export my-site export/ --files      # links that open from disk
npm run cli -- export my-site/home export/         # one page of the site: export/index.html
```

## What you get

```
export/
  index.html             opens the first page
  about/index.html
  home/index.html
  home/assets/…          each page's images and files, next to it
  pages/index.html       the list of pages
  favicon.svg            the site's icon (or your own favicon.png / favicon.ico)
  404.html               what web hosts show for an address that isn't there: the list of pages
```

- Links between pages and other addresses written from the site root (`/about/`, `/home/assets/logo.png`) become relative (`../about/`). The export works at the root of a domain, under a sub-path (`example.com/our-site/`), and from disk.
- Each page looks as it does in the editor at every width: its responsive rules and its `head.html` come along.

## What to check before publishing

The export reports two things:

- **Links to pages that don't exist**, for example after a page was removed or renamed outside TYKERF. Fix them in the Text tab, where link fields list the site's pages.
- **Images, fonts or files that still load from other servers:** a file a [copy of a website](importing.md) couldn't download, or an address you typed. The export works while those servers answer, but you usually may not republish someone else's images or fonts. Copy each image you're allowed to use into the page (the image tool's *Copy into the page*), and replace the rest.

An export only includes the files in `assets/` that a page uses. Earlier versions of cropped images and pictures of removed boxes stay behind.

<!-- tykerf:footer -->
---

← [Publishing and serving a site](publishing.md) · [User guide index](README.md) · [Pages and the notation](workspaces.md) →

[TYKERF](../../../README.md) · [Documentation](../../README.md) · [GitHub](https://github.com/eonity-org/tykerf) · Apache-2.0 · an [eonity](https://eonity.org) project
<!-- /tykerf:footer -->
