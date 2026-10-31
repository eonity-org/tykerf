// The handbook (src/handbook.ts): the page's theme and blocks, generated from the page as it is now.

import { describe, expect, it } from 'vitest';
import { createPage } from '../src/library.js';
import { handbookMarkdown, handbookPage, pageTheme } from '../src/handbook.js';
import { addTask, closeTask } from '../src/tasks.js';
import { MemoryStore } from '../src/store.js';
import { Workspace } from '../src/workspace.js';

const landing = () => {
  const ws = new Workspace(new MemoryStore('memory:handbook'));
  createPage(ws, 'launch', 'warm');
  return ws;
};

describe('the handbook', () => {
  it('lists the theme and every block in page order, with the chips that name it', () => {
    const ws = landing();
    const html = handbookPage(ws, 'bakery');
    expect(html).toContain('<title>Handbook · bakery</title>');
    expect(html).toContain('data-copy="var(--color-accent)"');
    expect(html).toContain('style="background:var(--color-accent)"');
    expect(html).toContain('data-copy="page/hero"');
    expect(html).toContain('data-copy="#sw-hero"');
    expect(html.indexOf('<b>nav</b>')).toBeLessThan(html.indexOf('<b>footer</b>'));
    // the page's own fonts, so the specimens show them
    expect(html).toMatch(/@font-face\s*\{[^}]*Playfair/);
    // the box's words, never its code
    expect(html).toContain('The short promise of your product');
    expect(html).not.toMatch(/<h1[^>]*>The short promise/);
  });

  it('shows the tasks on each block: open ones first, then the done ones with their reply', () => {
    const ws = landing();
    addTask(ws, { block: 'cta', text: 'Done one' });
    addTask(ws, { block: 'cta', path: [0], label: 'h2 "Try it"', width: 375, text: 'Open <one>' });
    closeTask(ws, 1, 'ai', 'Changed it.');
    const html = handbookPage(ws, 'bakery');
    expect(html.indexOf('Open &#60;one&#62;')).toBeLessThan(html.indexOf('Done one'));
    expect(html).toContain('✓ Changed it. (Kaity)');
    expect(html).toContain('1 task is open.');
    const md = handbookMarkdown(ws, 'bakery');
    expect(md).toMatch(/^# Handbook: bakery$/m);
    expect(md).toContain('- `--color-accent`: `#b02d1f`');
    expect(md).toMatch(/^ {2}- \*\*cta\*\* \(box; tags #tone-soft\) `page\/cta`: /m);
    expect(md).toContain('    - task #2 on cta › h2 "Try it" (element 0), seen 375 px wide: Open <one>');
  });

  it('takes a page\'s own theme values over its own theme', () => {
    const ws = landing();
    ws.setHead(`<style data-tykerf-override>\n:root {\n  --color-accent: #123456;\n}\n</style>\n${ws.head()}`, 'user');
    expect(pageTheme(ws)['--color-accent']).toBe('#123456');
  });
});
