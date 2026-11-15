// The v3 editor's way in: a page (/_tykerf/edit/<page>/: the page in its frame, shell.js) or the whole site
// (/_tykerf/edit/_site/<screen>: the sidebar docked beside a site screen, site.js).
if (location.pathname.startsWith('/_tykerf/edit/_site/')) await import('./site.js').then((m) => m.siteMode());
else await import('./shell.js');
