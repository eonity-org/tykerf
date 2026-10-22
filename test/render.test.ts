import { describe, expect, it } from 'vitest';
import { parse } from '../src/notation.js';
import { toHTML } from '../src/render.js';

describe('render', () => {
  it('page wrapper ids cannot collide with node ids (a node may be called "page" or "style")', () => {
    const html = toHTML({ root: parse('style a H@page'), overlays: [] });
    expect(html.match(/id="sw--page"/g)).toHaveLength(1);
    expect(html.match(/id="sw--style"/g)).toHaveLength(1);
    expect(html).toContain('id="sw-page"');
    expect(html).toContain('id="sw-style"');
  });
});
