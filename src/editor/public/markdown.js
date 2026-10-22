// Kaity's answers in the chat: the little Markdown models write (bold, italics, code, lists, headings,
// paragraphs) as HTML. Everything is escaped first, so only these few tags can come out of a model's words.

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** One line's marks: `code` first (its text is left as it is), then **bold**, then *italics* or _italics_. */
function inline(line) {
  return line.split(/(`[^`]+`)/).map((part) => (part.length > 2 && part.startsWith('`') && part.endsWith('`')
    ? `<code>${part.slice(1, -1)}</code>`
    : part
      .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '<strong>$1</strong>')
      // not inside words: snake_case and 2*3*4 stay as they are
      .replace(/(^|[^*\w])[*_](?=\S)(.+?)(?<=\S)[*_](?![*\w])/g, '$1<em>$2</em>'))).join('');
}

/** Markdown as HTML: paragraphs (single line breaks kept), - or 1. lists, # headings as bold lines. */
export function markdown(text) {
  const out = [];
  let para = [];
  let list = null;
  const endPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };
  const endList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  for (const raw of esc(String(text ?? '')).split('\n')) {
    const line = raw.trimEnd();
    const item = /^\s*(?:([-*•])|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      endPara();
      const tag = item[1] ? 'ul' : 'ol';
      if (list?.tag !== tag) endList(), (list = { tag, items: [] });
      list.items.push(item[2]);
      continue;
    }
    endList();
    const head = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (head) endPara(), out.push(`<p><strong>${inline(head[1])}</strong></p>`);
    else if (!line.trim()) endPara();
    else para.push(line);
  }
  endPara();
  endList();
  return out.join('');
}
