// Editing in place: the pure helpers behind it (no UI). tykerf.js uses them to find what can be edited
// on the page, to find the same element in the box's code, and to clean what the browser typed.
//
// Box code is never edited by guessing. An edit lands only on an element whose position in the
// code matches the page (scripts can change the page) and whose markup is the same there.

/** Elements that are not content: the code has them, but they are not where the words are. */
const SKIP = new Set(['STYLE', 'SCRIPT', 'TEMPLATE', 'NOSCRIPT']);
/** Inline marks allowed inside text edited in place. */
const MARKS = new Set(['STRONG', 'B', 'EM', 'I', 'A', 'BR']);
/** Elements whose text is not edited in place (form controls and the like). */
const NOT_TEXT = new Set(['TEXTAREA', 'SELECT', 'OPTION', 'INPUT', 'SVG', 'svg', 'CANVAS', 'VIDEO', 'AUDIO', 'IFRAME', 'OBJECT']);

const kids = (el) => [...el.children].filter((c) => !SKIP.has(c.nodeName));

/** Where an element is inside a box: the index among its content siblings at each level, or null. */
export function elementPath(el, root) {
  const path = [];
  for (let x = el; x !== root; x = x.parentElement) {
    if (!x?.parentElement || SKIP.has(x.nodeName)) return null;
    path.unshift(kids(x.parentElement).indexOf(x));
  }
  return path;
}

/** The element at a path (see elementPath) inside a box element or a parsed fragment of its code. */
export function atPath(root, path) {
  let x = root;
  for (const i of path) {
    x = kids(x)[i];
    if (!x) return null;
  }
  return x;
}

/** Whether an element holds only text and the inline marks. */
export function inlineOnly(el) {
  return [...el.childNodes].every((c) => c.nodeType === 3 || c.nodeType === 8 || (c.nodeType === 1 && MARKS.has(c.nodeName) && inlineOnly(c)));
}

/**
 * The element to edit for a pointer target inside a box: the nearest element made only of text and
 * marks (a heading, paragraph, list item, button, link...). A mark gives way to its block, and so
 * does a link inside a sentence. Null when the text sits next to other elements (an icon, an image):
 * that text is edited in the Text tab.
 */
export function editableAt(target, root) {
  for (let x = target?.nodeType === 3 ? target.parentElement : target; x && x !== root && root.contains(x); x = x.parentElement) {
    if (SKIP.has(x.nodeName) || NOT_TEXT.has(x.nodeName) || x.closest('svg')) return null;
    if (x.nodeName !== 'A' && MARKS.has(x.nodeName)) continue;
    const up = x.parentElement;
    if (x.nodeName === 'A' && up && up !== root && inlineOnly(up) && norm(up.textContent) !== norm(x.textContent)) continue;
    if (!norm(x.textContent)) return null;
    return inlineOnly(x) ? x : null;
  }
  return null;
}

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Whether the page element is still exactly what the code says (same tag, same markup inside): if a
 * script changed it, an edit can't be mapped back safely. (tykerf.js compares the markup an edit
 * started from the same way.)
 */
export function sameElement(page, code) {
  return !!page && !!code && page.nodeName === code.nodeName && page.innerHTML === code.innerHTML;
}

/** An image is the same when its tag and its src attribute are. */
export function sameImage(page, code) {
  return !!page && !!code && page.nodeName === 'IMG' && code.nodeName === 'IMG' && page.getAttribute('src') === code.getAttribute('src');
}

const SAFE_HREF = /^(https?:|mailto:|tel:|#|\/|\.|[^:]*$)/i;
/** Whether a link target may be written into a box (no javascript:, data: and the like). */
export const safeHref = (href) => SAFE_HREF.test(String(href).trim());

/**
 * The markup of an element after typing, cleaned: text, <br>, <strong>, <em> and <a href> only.
 * Elements that were there before editing (`known`) keep their tag and attributes (a styled link
 * stays styled); elements the browser added keep only the marks above (<b> becomes <strong>, <i>
 * becomes <em>) and links only their href. Anything else is unwrapped, keeping its text.
 */
export function cleanInline(el, known = new WeakSet()) {
  const doc = el.ownerDocument;
  const out = doc.createElement('div');
  const copy = (from, to, inMark) => {
    for (const c of from.childNodes) {
      if (c.nodeType === 3) to.append(doc.createTextNode(c.nodeValue));
      else if (c.nodeType !== 1) continue;
      else if (known.has(c)) {
        const k = c.cloneNode(false);
        to.append(k);
        copy(c, k, inMark);
      } else if (c.nodeName === 'BR') to.append(doc.createElement('br'));
      else {
        const tag = { B: 'strong', STRONG: 'strong', I: 'em', EM: 'em' }[c.nodeName];
        const href = c.nodeName === 'A' ? c.getAttribute('href') : null;
        if (tag && !inMark.has(tag)) {
          const m = doc.createElement(tag);
          copy(c, m, new Set([...inMark, tag]));
          if (m.childNodes.length) to.append(m);
        } else if (href && safeHref(href) && !inMark.has('a')) {
          const a = doc.createElement('a');
          a.setAttribute('href', href.trim());
          copy(c, a, new Set([...inMark, 'a']));
          if (a.childNodes.length) to.append(a);
        } else copy(c, to, inMark);
      }
    }
  };
  copy(el, out, new Set());
  // a <br> the browser leaves at the very end of an edited line shows nothing
  while (out.lastChild?.nodeName === 'BR') out.lastChild.remove();
  out.normalize();
  // the browser types a no-break space where a normal one would collapse: at the ends, and next to another space
  const texts = [];
  const walker = doc.createTreeWalker(out, 4);
  while (walker.nextNode()) texts.push(walker.currentNode);
  texts.forEach((n, i) => {
    let v = n.nodeValue.replace(/ (?= )|(?<= ) /g, ' ');
    if (i === 0) v = v.replace(/^ /, ' ');
    if (i === texts.length - 1) v = v.replace(/ $/, ' ');
    n.nodeValue = v;
  });
  return out.innerHTML;
}

// ---------- image crop ----------

/** The largest rectangle of an aspect ratio (w/h) centred in a W×H image; the whole image when aspect is null. */
export function fitAspect(W, H, aspect) {
  if (!aspect) return { x: 0, y: 0, w: W, h: H };
  const w = Math.min(W, H * aspect), h = w / aspect;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

/** The image size once turned by `quarter` quarter turns. */
export const turned = (w, h, quarter) => (quarter % 2 ? { w: h, h: w } : { w, h });

/**
 * A crop rectangle resized by dragging a corner ('nw', 'ne', 'sw', 'se') or an edge ('n', 's', 'e', 'w')
 * by dx, dy: the opposite side stays where it is, the result stays inside W×H and keeps an aspect if
 * one is set (dragging an edge then moves the side next to it too).
 */
export function resizeCrop(r, handle, dx, dy, aspect, W, H, min = 16) {
  const left = handle.includes('w'), right = handle.includes('e'), top = handle.includes('n'), bottom = handle.includes('s');
  const fx = left ? r.x + r.w : r.x, fy = top ? r.y + r.h : r.y;
  const maxW = left ? fx : W - fx, maxH = top ? fy : H - fy;
  const clamp = (v, hi) => Math.min(Math.max(v, Math.min(min, hi)), hi);
  let w = clamp(left ? r.w - dx : right ? r.w + dx : r.w, maxW);
  let h = clamp(top ? r.h - dy : bottom ? r.h + dy : r.h, maxH);
  if (aspect) {
    const sideways = left || right, upDown = top || bottom;
    if (sideways && upDown) {
      if (w / h > aspect) w = h * aspect;
      else h = w / aspect;
    } else if (sideways) {
      h = w / aspect;
      if (h > maxH) (h = maxH), (w = h * aspect);
    } else {
      w = h * aspect;
      if (w > maxW) (w = maxW), (h = w / aspect);
    }
  }
  return { x: left ? fx - w : fx, y: top ? fy - h : fy, w, h };
}

/** A crop rectangle moved by dx, dy, kept inside W×H. */
export function moveCrop(r, dx, dy, W, H) {
  return { ...r, x: Math.min(Math.max(0, r.x + dx), W - r.w), y: Math.min(Math.max(0, r.y + dy), H - r.h) };
}

/** The output size of a crop, scaled down so its longest side is at most `max` px (null: no limit). */
export function outputSize(w, h, max) {
  const k = max ? Math.min(1, max / Math.max(w, h)) : 1;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)), k };
}
