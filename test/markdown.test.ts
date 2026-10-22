// Kaity's answers in the chat (src/editor/public/markdown.js): a little Markdown, and nothing else.

import { describe, expect, it } from 'vitest';
import { markdown } from '../src/editor/public/markdown.js';

describe("Kaity's answers", () => {
  it('show bold, italics, code, lists and paragraphs', () => {
    expect(markdown("I've checked all the pages.\n\nHere is what I found:\n- **Nav:** the same `72px` height\n- *London* was missing\n\n1. one\n2. two"))
      .toBe("<p>I&#39;ve checked all the pages.</p><p>Here is what I found:</p><ul><li><strong>Nav:</strong> the same <code>72px</code> height</li><li><em>London</em> was missing</li></ul><ol><li>one</li><li>two</li></ol>");
    expect(markdown('## Done\nline one\nline two')).toBe('<p><strong>Done</strong></p><p>line one<br>line two</p>');
  });

  it('never let markup through, and leave words alone', () => {
    expect(markdown('<script>alert(1)</script> **<b>x</b>**')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt; <strong>&lt;b&gt;x&lt;/b&gt;</strong></p>');
    expect(markdown('`<nav>` keeps **its** tags as text')).toBe('<p><code>&lt;nav&gt;</code> keeps <strong>its</strong> tags as text</p>');
    expect(markdown('page_name and 2*3*4 stay')).toBe('<p>page_name and 2*3*4 stay</p>');
    expect(markdown('')).toBe('');
  });
});
