// A shared block changed from a page is a step of the site's history (site/history.ts), and the page's own
// Undo takes it back too while it is still the site's last step (Workspace: history kind 'site').

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { kitRead, kitWrite } from '../src/kit.js';
import { Site, linkBlock, newSitePage, pageWorkspace, shareBlock } from '../src/site.js';

/** A site of two pages showing one shared navigation. */
function twoPages() {
  const dir = mkdtempSync(join(tmpdir(), 'tykerf-site-undo-'));
  newSitePage(dir, 'home', 'launch', 'studio', { shared: false });
  newSitePage(dir, 'about', 'company', 'studio', { shared: false });
  shareBlock(dir, pageWorkspace(dir, 'home'), 'nav');
  linkBlock(dir, pageWorkspace(dir, 'about'), 'nav', 'nav');
  return { dir, home: pageWorkspace(dir, 'home'), about: pageWorkspace(dir, 'about'), site: new Site(dir) };
}

describe("a page's Undo of a shared block changed from it", () => {
  it('takes the change back on every page, and the site history with it; redo brings it back', () => {
    const { dir, home, about, site } = twoPages();
    const before = kitRead(dir, 'blocks', 'nav');
    about.setContent('nav', '<nav>changed from about</nav>', 'user');
    expect(home.content('nav')).toBe('<nav>changed from about</nav>');
    expect(about.peekUndo()).toMatchObject({ label: 'edit the shared block nav', box: 'nav', head: false, site: true, block: 'nav' });
    expect(site.history.peekUndo()?.label).toBe('edit the shared block nav');

    expect(about.undo()).toBe('edit the shared block nav');
    expect(kitRead(dir, 'blocks', 'nav')).toBe(before);
    expect(site.history.peekUndo()?.label).not.toBe('edit the shared block nav');
    expect(about.peekRedo()).toMatchObject({ site: true, block: 'nav', box: 'nav' });

    expect(about.redo()).toBe('edit the shared block nav');
    expect(kitRead(dir, 'blocks', 'nav')).toBe('<nav>changed from about</nav>');
    expect(site.history.peekUndo()?.label).toBe('edit the shared block nav');
    expect(about.history(1)[0]).toMatchObject({ kind: 'site', label: 'edit the shared block nav' });
  });

  it('is refused while other changes to the site came after it, and works once those are undone', () => {
    const { dir, about, site } = twoPages();
    about.setContent('nav', '<nav>one</nav>', 'user');
    kitWrite(dir, 'styles', 'base', 'h2 { color: red }'); // from the site manager, after it
    expect(() => about.undo()).toThrow(/other changes to the site came after it: undo it in the site manager \(\/_tykerf\/site\/\)/);
    expect(kitRead(dir, 'blocks', 'nav')).toBe('<nav>one</nav>'); // nothing changed
    expect(site.undo()).toBe('add kit/styles/base.css');
    expect(about.undo()).toBe('edit the shared block nav');
    expect(kitRead(dir, 'blocks', 'nav')).not.toBe('<nav>one</nav>');

    // and redo the other way: a site change after the undo leaves nothing for the page to redo
    kitWrite(dir, 'styles', 'base', 'h2 { color: blue }');
    expect(() => about.redo()).toThrow(/can't be redone here: the site changed since/);
  });

  it('passes over a change the site manager undid already', () => {
    const { dir, about, site } = twoPages();
    const before = kitRead(dir, 'blocks', 'nav');
    about.setContent('nav', '<nav>one</nav>', 'user');
    site.undo();
    expect(kitRead(dir, 'blocks', 'nav')).toBe(before);
    const step = site.history.peekUndo();
    expect(about.undo()).toBe('edit the shared block nav');
    expect(site.history.peekUndo()).toEqual(step); // the site's history is as it was
  });

  it('undoes a group with a shared block and a box of the page in order, and redoes it', () => {
    const { dir, about, site } = twoPages();
    const block = kitRead(dir, 'blocks', 'nav'), own = about.content('footer');
    about.group('new menu and footer', 'user', () => {
      about.setContent('nav', '<nav>menu</nav>', 'user');
      about.setContent('footer', '<footer>ours</footer>', 'user');
    });
    expect(about.peekUndo()).toMatchObject({ label: 'new menu and footer', site: true, block: 'nav' });
    expect(about.undo()).toBe('new menu and footer');
    expect([kitRead(dir, 'blocks', 'nav'), about.content('footer')]).toEqual([block, own]);
    expect(about.redo()).toBe('new menu and footer');
    expect([kitRead(dir, 'blocks', 'nav'), about.content('footer')?.trim()]).toEqual(['<nav>menu</nav>', '<footer>ours</footer>']);
    expect(site.history.peekUndo()?.label).toBe('edit the shared block nav');
  });

  it('is refused to Kaity working on one block, as a change to the head is', async () => {
    const { about } = twoPages();
    about.setContent('nav', '<nav>one</nav>', 'user');
    const { openTools } = await import('../src/editor/tools-client.js');
    const narrow = await openTools(about, 'footer');
    expect((await narrow.call('undo', {})).text).toMatch(/refused: undoing "edit the shared block nav" would change the shared block nav on every page that shows it, which is outside the scope "footer"/);
    await narrow.close();
    const whole = await openTools(about, about.load().root.id);
    expect((await whole.call('undo', {})).text).toBe('undid: edit the shared block nav');
    await whole.close();
  });
});
