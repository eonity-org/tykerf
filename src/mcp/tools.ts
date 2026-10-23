// TYKERF's MCP tools: let an AI edit a page through slicing-tree moves that can never leave the layout
// invalid. createTykerfServer builds them over one workspace; the stdio server (server.ts) and the
// editor's API runners (editor/tools-client.ts, in-process) both use it, so every AI gets the same
// tools, the same scope checks and the same history.

import { existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ANCHORS, KIND_WORD, type Layout, type OpKind, find, walk } from '../model.js';
import * as M from '../moves.js';
import { outline, parseShape, serializeSlice } from '../notation.js';
import { pathOf, positionOf, resolveRef } from '../refs.js';
import { inScope, scopeViolation } from '../scope.js';
import { cost, optimize } from '../shape.js';
import { leftovers, missingFiles, say } from '../check.js';
import { newSitePage, pageWorkspace, siteHead, unsafeSVG, siteOf, sitePages, usePage } from '../site.js';
import { DEFAULT_THEME, components, createPage, hasTheme, pageLayouts, readOverrides, readTheme, setTheme, themeTarget, themes, useComponent, useLayout } from '../library.js';
import { FolderStore } from '../store.js';
import type { Workspace } from '../workspace.js';

const text = (s: string, isError = false) => ({ content: [{ type: 'text' as const, text: s }], isError });

function describe(l: Layout): string {
  return outline(l);
}

/** Outline lines keyed by node/overlay id, without the tree-drawing prefix. */
function outlineById(l: Layout): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of outline(l).split('\n')) {
    const clean = line.replace(/^[\s│├└─]+/, '');
    const key = clean.startsWith('overlay ') ? clean.split(' ')[1] : clean.startsWith('rule ') ? `rule:${clean.split(' ')[1]}` : clean.split(' ')[0];
    m.set(key, clean);
  }
  return m;
}

/** Compact reply: only the nodes whose outline line changed (kind, attributes or position). */
function changes(prev: Layout, next: Layout): string {
  const a = outlineById(prev), b = outlineById(next);
  const out: string[] = [];
  for (const [k, line] of b) if (a.get(k) !== line) out.push(`${a.has(k) ? '~' : '+'} ${line}`);
  for (const k of a.keys()) if (!b.has(k)) out.push(`- ${k} removed`);
  return out.length ? out.join('\n') : '(no change)';
}

function guard<A>(fn: (a: A) => Promise<string> | string) {
  return async (a: A) => {
    try {
      return text(await fn(a));
    } catch (e) {
      const m = (e as Error).message;
      // an empty folder (a new one picked in Claude Desktop, say): say how to start, not what is missing
      if (m.startsWith('no layout.slice')) return text(`error: no page is open. In an empty folder, use_layout starts one (list_layouts shows the layouts, list_themes the themes; "blank" is the simplest). In a site, list_pages shows its pages, open_page opens one and new_page makes one.`, true);
      return text(`error: ${m}\n(layout unchanged; call get_layout to see it)`, true);
    }
  };
}

const KIND_LETTER = Object.fromEntries(Object.entries(KIND_WORD).map(([k, w]) => [w, k])) as Record<string, OpKind>;
const id = z.string().describe('node reference: name ("faq"), path ("page/row2/faq", "row2/2" = 2nd child) or position from the root ("#4.2")');
const ids = z.array(id).min(2);
const shapes = z.array(z.string()).describe('shape variants: "text:<chars>[:<fontPx>[:<lineHeight>]]", "image:<w/h aspect>", "fixed:<w>:<h>"');

/** Outline of one block's subtree, with positions relative to the whole page. */
function scopeOutline(l: Layout, scopeId: string): string {
  const all = outline(l).split('\n');
  const start = all.findIndex((x) => x.replace(/^[\s│├└─]+/, '').startsWith(`${scopeId} `));
  if (start < 0) return describe(l);
  const indent = all[start].length - all[start].replace(/^[\s│├└─]+/, '').length;
  const out = [all[start].slice(indent)];
  for (const line of all.slice(start + 1)) {
    const ind = line.length - line.replace(/^[\s│├└─]+/, '').length;
    if (ind <= indent || line.startsWith('overlay ') || line.startsWith('rule ')) break;
    out.push(line.slice(indent));
  }
  return out.join('\n');
}

export interface TykerfServerOptions {
  /** The block of one editor AI run. It holds for this server only and can't be lifted (it follows renames). */
  scope?: string | null;
  /**
   * The folder the server was started on, when it may work on the pages of a site (list_pages, open_page,
   * new_page): a site, an empty folder, or a page of a site. Without it the server keeps to `ws`.
   */
  home?: string | null;
}

/** The MCP server with every TYKERF tool, working on `ws`. */
export function createTykerfServer(ws: Workspace, opts: TykerfServerOptions = {}): McpServer {
  let runScope = opts.scope ?? null;

  const server = new McpServer({ name: 'tykerf', version: '0.1.0' }, {
    instructions:
      'Edit a web page whose layout is a tree of boxes. A "row" places its children side by side (left to right); ' +
      'a "column" stacks them top to bottom; "wheel" is a pinwheel (top,right,bottom,left,center); "periphery" is a page frame ' +
      '(north,west,center,east,south; "_" = empty slot). Any box can have maxw (max width in px, centered) and minh ' +
      '(min height in px: taller than its content, never shorter). ' +
      'The tree is the base layout for every width; use add_rule for narrow screens (e.g. below=600: flip a row into a column, ' +
      'stack a periphery, change ratios, hide a box) instead of changing the base layout. ' +
      'If a request cannot be expressed with these tools, say so instead of experimenting on the page. ' +
      'When the user names a block, call focus on it first; edits outside a scope are refused. ' +
      'Boxes and containers may have a type (get_types): moves and code that break their placement or content rules are refused. ' +
      'Call get_layout first. Refer to nodes by name ("faq"), path ("page/row2/faq", "row2/2") or position ("#4.2"); use resolve to check a reference. Every edit is validated; replies list only the nodes that changed. ' +
      'Leaf content is HTML set with set_content; for a change to part of a box (a value, a sentence, one rule) use edit_content, which replaces only that text and is much quicker on long code. Call evaluate to check the result at 375/768/1440 px, and screenshot to look at it ' +
      '(colours, spacing, alignment, text that spills out): after changing how something looks, look at it at 1440 and 375 px and fix what is wrong. ' +
      'The page theme (colours, fonts, radius, spacing, content width) is a set of CSS variables that every box uses: read it with get_theme ' +
      'and change it with set_theme, which restyles the whole page. Only allowed when the scope is the whole page (or there is no scope); ' +
      'inside a smaller block, change that block\'s own code instead, or ask the user to select the page block. ' +
      'Pictures are files in the page\'s assets/, written assets/<file> (no leading slash). You can\'t download pictures: draw one as SVG, or place one the user attached, with add_picture; when neither fits, say what picture is needed. Never make up a file name. ' +
      'For a new section (hero, features, FAQ, pricing, footer...), start from a ready-made component (list_components, use_component) ' +
      'and adapt its text and images, instead of writing the code from scratch. To make a page like another page of its site, use_page copies that page\'s blocks. ' +
      (opts.home && !opts.scope ? 'A site is a folder of pages: list_pages shows them and which one is open, open_page switches the page every other tool works on, and new_page makes one. When there are several, say which page you are working on.' : ''),
  });

  /**
   * The block the AI is limited to: this run's block (--scope) or the workspace .scope, and who set it.
   * A user's scope whose block is gone refuses every tool instead of silently lifting the limit.
   */
  function scopeInfo(l: Layout = ws.load()): { id: string; author: string } | null {
    const s = runScope ? { id: runScope, author: 'user' } : ws.scopeSetting();
    if (!s) return null;
    if (find(l.root, s.id)) return s;
    if (s.author === 'user') throw new Error(`refused: the block "${s.id}" you were limited to no longer exists; ask the user to select a block again`);
    return null;
  }
  const scope = (l?: Layout) => scopeInfo(l)?.id ?? null;

  /** Save a change if it stays inside the scope (when one is set) and passes the box types. */
  function commit(prev: Layout, next: Layout, label: string, scopeNext?: string) {
    const sc = scope(prev);
    if (sc) {
      const v = scopeViolation(prev, next, sc, scopeNext ?? sc);
      if (v) throw new Error(`refused: ${v}. Only "${pathOf(prev, sc)}" may change; ask the user to widen the scope.`);
    }
    ws.save(next, label);
  }

  function assertInScope(l: Layout, target: string) {
    const sc = scope(l);
    if (sc && !inScope(l, sc, target)) throw new Error(`refused: "${target}" is outside the scope "${pathOf(l, sc)}"; ask the user to widen the scope.`);
  }

  /** A box or overlay: an overlay id as is, anything else as a node reference. */
  const boxRef = (l: Layout, ref: string) => (l.overlays.some((o) => o.id === ref) ? ref : resolveRef(l, ref));

  /** Replace every node-reference argument (schema `id` / `ids`) by the node's name (spec §5). */
  function resolveArgs<A extends Record<string, unknown>>(l: Layout, shape: z.ZodRawShape, a: A): A {
    const out: Record<string, unknown> = { ...a };
    for (const [k, schema] of Object.entries(shape)) {
      const v = out[k];
      if (schema === id && typeof v === 'string') out[k] = resolveRef(l, v);
      else if (schema === ids && Array.isArray(v)) out[k] = v.map((x) => resolveRef(l, String(x)));
    }
    return out as A;
  }

  function moveTool<S extends z.ZodRawShape>(name: string, description: string, shape: S, apply: (l: Layout, a: z.infer<z.ZodObject<S>>) => Layout, after?: (a: z.infer<z.ZodObject<S>>) => void) {
    server.registerTool(name, { description, inputSchema: shape }, guard((raw: z.infer<z.ZodObject<S>>) => ws.transaction(() => {
      const prev = ws.load();
      const a = resolveArgs(prev, shape, raw);
      const next = apply(prev, a);
      commit(prev, next, `${name} ${JSON.stringify(a)}`);
      after?.(a);
      return `ok\n${changes(prev, next)}`;
    })) as never);
  }

  server.registerTool('get_layout', { description: 'Current layout as an outline: ids, kinds (row/column/wheel/periphery), types, ratios, tags, maxw, positions. When a scope is set, only the scope block is shown.' },
    guard(() => {
      const l = ws.load();
      const sc = scopeInfo(l);
      if (!sc) return describe(l);
      return `scope: ${pathOf(l, sc.id)} (set by ${sc.author}) — you may only change this block\n\n${scopeOutline(l, sc.id)}`;
    }));

  server.registerTool('focus', {
    description: 'Limit your changes to one block (and everything inside it): any edit that would change the page outside it is refused. Returns the block outline and the code of its boxes. Not allowed when the user has set the scope.',
    inputSchema: { ref: id },
  }, guard(({ ref }: { ref: string }) => ws.transaction(() => {
    const l = ws.load();
    const user = scopeInfo(l);
    const target = resolveRef(l, ref);
    if (user?.author === 'user' && !inScope(l, user.id, target)) throw new Error(`refused: the user limited changes to "${pathOf(l, user.id)}"`);
    if (user?.author !== 'user') ws.setScope(target, 'ai');
    const codes: string[] = [];
    walk(find(l.root, target)!.node, (n) => {
      if (n.type === 'leaf') codes.push(`--- ${n.id} ---\n${ws.content(n.id) ?? '(placeholder)'}`);
    });
    return `scope: ${pathOf(l, scope(l)!)}\n\n${scopeOutline(l, target)}\n\n${codes.join('\n')}`;
  })) as never);

  server.registerTool('unfocus', { description: 'Remove a scope you set with focus. A scope set by the user cannot be removed.' },
    guard(() => ws.transaction(() => {
      const sc = scopeInfo();
      if (!sc) return 'no scope set';
      if (sc.author === 'user') throw new Error('refused: the scope was set by the user');
      ws.setScope(null);
      return 'scope removed';
    })));

  /** The theme restyles the whole page, so it may only change when the scope is the whole page (or there is none). */
  function assertThemeScope() {
    const l = ws.load();
    const sc = scope(l);
    const root = l.root.id;
    if (sc && sc !== root) throw new Error(`refused: the theme changes the whole page, and the scope is "${sc}". Ask the user to select the page block ("${root}") to change the theme, or restyle "${sc}" in its own code.`);
  }

  server.registerTool('get_theme', { description: 'The page theme: CSS variables (colours, fonts, radius, spacing, content width) that every box uses, as name: value. Empty when the page has no theme.' },
    guard(() => {
      const own = readTheme(ws.head());
      const mine = readOverrides(ws.head());
      const vars = Object.keys(own).length ? own : { ...readTheme(ws.siteHead()), ...mine };
      const shared = Object.keys(own).length ? '' : `(the theme every page of the site shares${Object.keys(mine).length ? `, with this page's own values for ${Object.keys(mine).join(', ')}` : ''}; ${themeTarget(ws) === 'site' ? 'this is the site\'s only page, so set_theme changes the site theme' : 'set_theme sets this page\'s own values over it; the other pages keep theirs'})\n`;
      return Object.keys(vars).length ? shared + Object.entries(vars).map(([n, v]) => `${n}: ${v}`).join('\n') : 'this page has no theme (the user can add one in the Page tab of the top block)';
    }));

  server.registerTool('set_theme', {
    description: 'Change theme variables of the whole page, e.g. {"--color-accent": "#c2185b", "--font-heading": "Georgia, serif"}. Only existing variables; colours must be colours, lengths lengths, fonts a list of installed font names (no url(), no web fonts). Refused unless the scope is the whole page. One undo step.',
    inputSchema: { values: z.record(z.string(), z.string()).describe('variable name -> new value') },
  }, guard(({ values }: { values: Record<string, string> }) => ws.transaction(() => {
    assertThemeScope();
    const where = themeTarget(ws);
    const changed = setTheme(ws, values, 'ai');
    const lines = Object.entries(changed).map(([n, c]) => `${n}: ${c.from} -> ${c.to}`);
    const what = where === 'site' ? 'site theme changed (this is the site\'s only page)' : where === 'override' ? 'this page\'s own theme values changed (the other pages of the site keep the shared theme)' : 'theme changed';
    return lines.length ? `${what}:\n${lines.join('\n')}` : 'theme unchanged (the values were already set)';
  })));

  server.registerTool('list_themes', { description: 'Theme presets: a whole set of colours, fonts and spacing in one go (apply one with use_theme, then fine-tune with set_theme).' },
    guard(() => themes().map((t) => `${t.name}: ${t.label}. ${t.description}`).join('\n')));

  server.registerTool('use_theme', {
    description: 'Apply a theme preset (see list_themes) to the whole page: every theme variable takes the preset\'s value. Like set_theme, only when the scope is the whole page. One undo step.',
    inputSchema: { name: z.string().describe('preset name from list_themes') },
  }, guard(({ name }: { name: string }) => ws.transaction(() => {
    assertThemeScope();
    const p = themes().find((t) => t.name === name);
    if (!p) throw new Error(`unknown theme "${name}" (known: ${themes().map((t) => t.name).join(', ')})`);
    const where = themeTarget(ws);
    const changed = setTheme(ws, p.values, 'ai');
    const n = Object.keys(changed).length;
    return n ? `${where === 'site' ? 'site theme' : where === 'override' ? 'this page\'s own theme values' : 'theme'} now follows the ${name} preset (${n} values changed)` : `the theme already follows the ${name} preset`;
  })));

  server.registerTool('list_layouts', { description: 'Page layouts: whole ready-made pages (a tree of blocks, each filled with a component and placeholder text), for starting or restarting a page with use_layout.' },
    guard(() => pageLayouts().map((p) => `${p.name}: ${p.label}. ${p.description}`).join('\n')));

  server.registerTool('use_layout', {
    description: 'Replace the WHOLE page with a page layout (see list_layouts): its blocks, each with a component and placeholder text to rewrite. Everything the page held is replaced (the theme stays); undo brings it back. Only when the scope is the whole page. One undo step. ' +
      'In a folder with no page yet, it starts the page there, with the theme given (see list_themes).',
    inputSchema: { name: z.string().describe('layout name from list_layouts'), theme: z.string().optional().describe(`theme preset from list_themes, for a new page only (default ${DEFAULT_THEME})`) },
  }, guard(({ name, theme: themeName }: { name: string; theme?: string }) => {
    if (!ws.store.exists('layout.slice')) {
      if (runScope) throw new Error('refused: there is no page here yet, and this run may only change one block of one');
      // a page right in a site folder would hide the site's pages
      const pages = ws.store instanceof FolderStore ? sitePages(ws.dir) : [];
      if (pages.length) throw new Error(`refused: this folder is a site of pages (${pages.join(', ')}); open one with open_page, or make another with new_page`);
      if (ws.store instanceof FolderStore) mkdirSync(ws.dir, { recursive: true }); // the lock lives in the folder
      return ws.transaction(() => {
        createPage(ws, name, themeName ?? DEFAULT_THEME);
        return `ok: a new page from the ${name} layout with the ${themeName ?? DEFAULT_THEME} theme; rewrite every box's placeholder text for this page\n\n${outline(ws.load())}`;
      });
    }
    return ws.transaction(() => {
      const l = ws.load();
      const sc = scope(l);
      if (sc && sc !== l.root.id) throw new Error(`refused: a layout replaces the whole page, and the scope is "${sc}". Ask the user to select the page block ("${l.root.id}").`);
      useLayout(ws, name, 'ai');
      return `ok: the page now follows the ${name} layout; rewrite every box's placeholder text for this page\n\n${outline(ws.load())}`;
    });
  }));

  server.registerTool('use_page', {
    description: 'Make this page like another page of its site: replace the WHOLE page with that page\'s blocks, box code and images (its text too, to rewrite for this page). ' +
      'The page keeps its own theme unless theme is true. Only when the scope is the whole page. One undo step; undo brings the page back.',
    inputSchema: { page: z.string().describe('the other page\'s name'), theme: z.boolean().optional().describe('also take that page\'s theme and fonts') },
  }, guard(({ page, theme: withTheme }: { page: string; theme?: boolean }) => ws.transaction(() => {
    if (!(ws.store instanceof FolderStore) || !ws.site?.pageNames) throw new Error('this page is not part of a site, so there is no other page to copy');
    const l = ws.load();
    const sc = scope(l);
    if (sc && sc !== l.root.id) throw new Error(`refused: copying a page replaces the whole page, and the scope is "${sc}". Ask the user to select the page block ("${l.root.id}").`);
    usePage(ws, dirname(ws.dir), page, { theme: withTheme, author: 'ai' });
    return `ok: the page now has the blocks of "${page}"${withTheme ? ', and its theme' : ''}; rewrite their text for this page\n\n${outline(ws.load())}`;
  })));

  server.registerTool('list_components', { description: 'Ready-made sections (hero, features, FAQ, pricing, footer...) that fill a box with working code styled by the page theme, at every width. Use one with use_component, then adapt its text and images.' },
    guard(() => components().map((c) => `${c.name}: ${c.label}. ${c.description}`).join('\n')));

  server.registerTool('use_component', {
    description: 'Fill a box with a ready-made component (see list_components), replacing its code; the placeholder images it uses are copied to assets/. ' +
      'Components style themselves with the theme variables: if the page has no theme yet, they are added to the page head, which needs the whole page in scope. ' +
      'One undo step. Replies with the new code, so you can adapt its text with set_content.',
    inputSchema: { id: id.describe('the box (leaf) to fill'), name: z.string().describe('component name from list_components') },
  }, guard(({ id: ref, name }: { id: string; name: string }) => ws.transaction(() => {
    const l = ws.load();
    const target = resolveRef(l, ref);
    if (find(l.root, target)?.node.type !== 'leaf') throw new Error(`"${ref}" is not a box (leaf); split it or add a box first`);
    assertInScope(l, target);
    const sc = scope(l);
    const themed = hasTheme(ws.siteHead() + ws.head());
    if (!themed && sc && sc !== l.root.id)
      throw new Error(`refused: this page has no theme yet, and adding its variables changes the page head, which is outside the scope "${sc}". Ask the user to select the page block ("${l.root.id}"), or to use the component from the editor panel.`);
    useComponent(ws, target, name, 'ai');
    return `ok: "${target}" now holds the ${name} component${themed ? '' : ' (the theme variables were added to the page head)'}\n\n${ws.content(target)}`;
  })) as never);

  server.registerTool('get_types', { description: 'Box types of this page: where each type may be placed (within, notWithin, children, max) and what its code may contain. Moves and set_content that break these rules are refused.' },
    guard(() => JSON.stringify(ws.types(), null, 2)));

  moveTool('swap', 'Exchange two subtrees (M1). Their ratios travel with them.', { a: id, b: id }, (l, a) => M.swap(l, a.a, a.b));
  moveTool('flip', 'Turn a row into a column or a column into a row (rotation).', { op: id }, (l, a) => M.flip(l, a.op));
  moveTool('wrap', 'Group 2+ contiguous siblings of a row/column under a new row (side by side) or column (stacked).',
    { ids, kind: z.enum(['row', 'column']), new_id: z.string().optional() },
    (l, a) => M.wrap(l, a.ids, KIND_LETTER[a.kind] as 'H' | 'V', a.new_id));
  moveTool('unwrap', 'Dissolve a row/column into its parent (inverse of wrap).', { op: id }, (l, a) => M.unwrap(l, a.op));
  moveTool('split', 'Turn a leaf into a row/column/wheel/periphery of n blocks: the leaf keeps its name and code and becomes the first block (wheel/periphery: the center), and n-1 new empty leaves follow it (wheel/periphery always 5 slots). ' +
    'E.g. to turn "text" into hero, stats, footer: split text column names=["stats","footer"], then rename text to hero.',
    { leaf: id, kind: z.enum(['row', 'column', 'wheel', 'periphery']), n: z.number().int().min(2).optional().describe('how many blocks in all, the leaf included; leave it out to use names.length + 1'), names: z.array(z.string()).optional().describe('names for the n-1 new leaves only (not the leaf being split)') },
    (l, a) => M.split(l, a.leaf, KIND_LETTER[a.kind], a.n ?? (a.names?.length ? a.names.length + 1 : undefined), a.names));
  moveTool('add_leaf', 'Insert a new leaf into a row/column at a 0-based index, or into an empty wheel/periphery slot index.',
    { parent: id, index: z.number().int().min(0), name: z.string(), role: z.string().optional(), type: z.string().optional().describe('box type (see get_types); its template becomes the code'), shapes: shapes.optional(), minw: z.number().optional() },
    (l, a) => M.addLeaf(l, a.parent, a.index, a.name, { role: a.role, boxType: a.type, shapes: a.shapes?.map(parseShape), minW: a.minw }),
    (a) => {
      const tpl = a.type ? ws.template(a.type) : null;
      if (tpl && ws.content(a.name) === null) ws.setContent(a.name, tpl);
    });
  moveTool('remove', 'Delete a subtree. A row/column left with one child dissolves; wheel/periphery slots become empty.', { id }, (l, a) => M.remove(l, a.id));
  moveTool('move', 'Move a subtree into another row/column at a 0-based index (wheel/periphery: an empty slot index).',
    { id, parent: id, index: z.number().int().min(0) }, (l, a) => M.move(l, a.id, a.parent, a.index));
  moveTool('set_ratios', 'Set relative sizes: row/column one weight per child (e.g. [1,2,1]); wheel/periphery three column weights. null = equal.',
    { op: id, ratios: z.array(z.number().positive()).nullable() }, (l, a) => M.setRatios(l, a.op, a.ratios));
  moveTool('set_op', 'Set gap (px), cross-axis alignment, and/or maxw (max width in px, centered — e.g. a readable page column) of a row/column/wheel/periphery. null clears.',
    { op: id, gap: z.number().min(0).nullable().optional(), align: z.enum(['start', 'center', 'end', 'stretch']).nullable().optional(), maxw: z.number().positive().nullable().optional(), minh: z.number().min(0).nullable().optional().describe('min height in px (never shorter than the content)'), type: z.string().nullable().optional().describe('container type (see get_types); null clears') },
    (l, a) => M.setOp(l, a.op, { gap: a.gap, align: a.align, maxW: a.maxw, minH: a.minh, boxType: a.type }));
  moveTool('set_leaf', 'Set role (header, nav, main, aside, footer, section, article), shape variants, min width (optimizer hint) and maxw (max width in px, centered) of a leaf.',
    { leaf: id, role: z.string().nullable().optional(), type: z.string().nullable().optional().describe('box type (see get_types); null clears'), shapes: shapes.optional(), minw: z.number().nullable().optional(), maxw: z.number().positive().nullable().optional(), minh: z.number().min(0).nullable().optional().describe('min height in px (never shorter than the content)') },
    (l, a) => M.setLeaf(l, a.leaf, { role: a.role, boxType: a.type, shapes: a.shapes?.map(parseShape), minW: a.minw, maxW: a.maxw, minH: a.minh }));
  moveTool('set_variant', 'Choose which shape variant a leaf uses (0-based).', { leaf: id, variant: z.number().int().min(0) },
    (l, a) => M.setVariant(l, a.leaf, a.variant));
  moveTool('tag', 'Add a tag (written here with #, passed with or without it: "tone-alt" or "#tone-alt"). Tags become CSS classes t-<tag>. Band tones: #tone-alt, #tone-soft, #tone-dark; #dense packs a section tighter. Special: #priority (must be in first screen), #lock / #equal (optimizer constraints), semantic tags (#main, #section...) on operators.',
    { id, tag: z.string() }, (l, a) => M.tag(l, a.id, a.tag.trim().replace(/^#/, '')));
  moveTool('untag', 'Remove a tag.', { id, tag: z.string() }, (l, a) => M.untag(l, a.id, a.tag.trim().replace(/^#/, '')));
  moveTool('attach_overlay', 'Attach an overlay (modal, badge, tooltip) floating over a target node, with z-index. anchor = where inside the target: "box" = centered over it; "top"/"bottom"/"left"/"right" = against the middle of that edge; "top-left"/"top-right"/"bottom-left"/"bottom-right" = tucked into that corner. Its HTML comes from set_content(overlay id).',
    { id: z.string(), target: id, anchor: z.enum(ANCHORS as [string, ...string[]]), z: z.number().int().optional() },
    (l, a) => M.attachOverlay(l, a.id, a.target, a.anchor as never, a.z));
  moveTool('add_rule', 'Responsive rule, active while the viewport is narrower than `below` px. action "flip": a row becomes a column (or a column a row); a wheel/periphery stacks all its slots top to bottom in reading order. "ratios": override the ratios of a row/column (one per child) or wheel/periphery (3 column weights). "hide": hide a box. When several rules hit the same box, the smallest `below` wins.',
    { below: z.number().int().positive(), action: z.enum(['flip', 'ratios', 'hide']), target: id, ratios: z.array(z.number().positive()).optional(), id: z.string().optional() },
    (l, a) => M.addRule(l, a.below, a.action, a.target, a.ratios, a.id));
  moveTool('remove_rule', 'Remove a responsive rule by id.', { id: z.string() }, (l, a) => M.removeRule(l, a.id));
  server.registerTool('resolve', {
    description: 'Resolve a node reference (name, path like page/row2/faq or row2/2, position like #4.2) to its canonical path, position and kind.',
    inputSchema: { ref: z.string() },
  }, guard(({ ref }: { ref: string }) => {
    const l = ws.load();
    const nid = resolveRef(l, ref);
    const line = outline(l).split('\n').find((x) => x.replace(/^[\s│├└─]+/, '').startsWith(`${nid} `)) ?? nid;
    return `${pathOf(l, nid)}  ${positionOf(l, nid)}\n${line.replace(/^[\s│├└─]+/, '')}`;
  }) as never);

  server.registerTool('rename', {
    description: 'Rename a node or overlay; every reference to it (rules, overlays) and its box code file are updated in the same undoable step. Use meaningful names so people can track the block.',
    inputSchema: { ref: id, new_name: z.string() },
  }, guard(({ ref, new_name }: { ref: string; new_name: string }) => ws.transaction(() => {
    const prev = ws.load();
    const target = boxRef(prev, ref);
    const sc = scope(prev);
    if (sc) {
      const v = scopeViolation(prev, M.rename(prev, target, new_name), sc, sc === target ? new_name : sc);
      if (v) throw new Error(`refused: ${v}`);
    }
    const next = ws.rename(target, new_name, 'ai');
    if (runScope === target) runScope = new_name; // the run's scope follows its block, as .scope does
    return `ok\n${changes(prev, next)}`;
  })) as never);

  moveTool('detach_overlay', 'Remove an overlay.', { id: z.string() }, (l, a) => M.detachOverlay(l, a.id));
  moveTool('normalize', 'Canonical form: merge nested rows-in-rows / columns-in-columns into one.', {}, (l) => M.normalizeLayout(l));

  server.registerTool('optimize', {
    description: 'Tune the BASE ratios and leaf shape variants for one viewport width using shape functions (minimize height + wasted space + line-length/min-width penalties). This changes the layout at every width; for narrow screens prefer add_rule. Respects #lock and #equal.',
    inputSchema: { width: z.number().int().min(200) },
  }, guard(({ width }: { width: number }) => {
    // optimizing can take a while, so it runs outside the lock; the result is saved only onto the layout it started from
    const prev = ws.load();
    const r = optimize(prev, width);
    ws.transaction(() => {
      if (serializeSlice(ws.load()) !== serializeSlice(prev)) throw new Error('the page changed while optimizing; call optimize again');
      commit(prev, r.layout, `optimize ${width}`);
    });
    const f = (c: { cost: number; height: number }) => `cost ${c.cost.toFixed(0)} (height ${c.height.toFixed(0)}px)`;
    return `before: ${f(r.before)}\nafter:  ${f(r.after)}\n${changes(prev, r.layout)}`;
  }) as never);

  server.registerTool('estimate', {
    description: 'Shape-function estimate of page height, wasted space and penalties at a width (fast, no browser).',
    inputSchema: { width: z.number().int().min(200) },
  }, guard(({ width }: { width: number }) => JSON.stringify(cost(ws.load(), width))) as never);

  /** A warning after a box's code changed, when it uses files the page doesn't have (made-up picture names). */
  function noFiles(html: string): string {
    const miss = missingFiles(ws, html);
    if (!miss.length) return '';
    const have = ws.assets().filter((f) => !/\.(woff2?|ttf|otf)$/i.test(f));
    return `\nwarning: ${miss.join(', ')} ${miss.length === 1 ? 'is' : 'are'} not among the page's files, so ${miss.length === 1 ? 'it shows' : 'they show'} broken. ` +
      `The page's files: ${have.length ? have.map((f) => `assets/${f}`).join(', ') : 'none'}. You can't download files: draw the picture as SVG with add_picture, ` +
      'place a picture the user attached with add_picture, or say what picture is needed so the user adds it (the picture tool in the Text tab). Never guess a file name.';
  }

  server.registerTool('add_picture', {
    description: 'Add a picture to the page\'s files (assets/), to use in a box as <img src="assets/<name>.<ext>">: either an SVG you draw (an illustration, an icon, a pattern), ' +
      'or a picture the user attached to the request (its file name, as the request says). You can\'t download pictures from the internet.',
    inputSchema: {
      name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,59}$/).describe('file name without extension: lowercase letters, digits and dashes (e.g. marienplatz)'),
      svg: z.string().optional().describe('the SVG code, from <svg> to </svg>: no scripts, no event attributes, no external files'),
      attached: z.string().optional().describe('the file name of a picture the user attached (e.g. 3f2a….png)'),
    },
  }, guard(({ name, svg, attached }: { name: string; svg?: string; attached?: string }) => {
    if (!svg === !attached) throw new Error('give either svg (a picture you draw) or attached (a picture the user attached)');
    let bytes: Uint8Array, ext: string;
    if (svg !== undefined) {
      const code = svg.trim();
      const why = unsafeSVG(code);
      if (why) throw new Error(`the SVG can't be used: ${why}; it may not have scripts, event attributes, foreignObject or links to other files`);
      if (code.length > 300_000) throw new Error('the SVG is larger than 300 KB; draw it with fewer points');
      bytes = new TextEncoder().encode(code.includes('xmlns=') ? code : code.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"'));
      ext = 'svg';
    } else {
      const m = /^[0-9a-f]{40}\.(png|jpe?g|gif|webp)$/.exec(attached!);
      const found = m ? ws.store.readBytes(`.tykerf/images/${attached}`) : null;
      if (!found) throw new Error(`no attached picture "${attached}": use the file name the request gives`);
      bytes = found;
      ext = m![1];
    }
    // a name already taken keeps its file (boxes may use it): this one gets a number
    let file = `${name}.${ext}`;
    for (let i = 2; ws.store.exists(`assets/${file}`); i++) file = `${name}-${i}.${ext}`;
    ws.store.write(`assets/${file}`, bytes);
    return `saved assets/${file}: use it as <img src="assets/${file}" alt="…"> (the address has no leading slash)`;
  }) as never);

  server.registerTool('set_content', {
    description: 'Set the HTML content of a leaf or overlay (null removes it, showing a placeholder).',
    inputSchema: { id: id.describe('box (leaf) reference or overlay id'), html: z.string().nullable() },
  }, guard(({ id: ref, html }: { id: string; html: string | null }) => ws.transaction(() => {
    const l = ws.load();
    const target = boxRef(l, ref);
    const ov = l.overlays.find((o) => o.id === target);
    if (!ov && find(l.root, target)?.node.type !== 'leaf') throw new Error(`"${ref}" is not a box (leaf) or overlay`);
    assertInScope(l, ov ? ov.target : target);
    ws.setContent(target, html);
    return `ok: content of "${target}" ${html === null ? 'removed' : 'set'}${noFiles(html ?? '')}`;
  })) as never);

  server.registerTool('edit_content', {
    description: 'Change part of a box\'s code: replace the exact text `old` (as get_content shows it, including spaces) with `new`. ' +
      '`old` must appear exactly once, unless all is true (then every occurrence changes). Prefer it to set_content for small changes: only the changed text is sent.',
    inputSchema: { id: id.describe('box (leaf) reference or overlay id'), old: z.string().min(1), new: z.string(), all: z.boolean().optional() },
  }, guard(({ id: ref, old, new: next, all }: { id: string; old: string; new: string; all?: boolean }) => ws.transaction(() => {
    const l = ws.load();
    const target = boxRef(l, ref);
    const ov = l.overlays.find((o) => o.id === target);
    if (!ov && find(l.root, target)?.node.type !== 'leaf') throw new Error(`"${ref}" is not a box (leaf) or overlay`);
    assertInScope(l, ov ? ov.target : target);
    const code = ws.content(target);
    if (code === null) throw new Error(`"${target}" has no code yet; use set_content`);
    const n = code.split(old).length - 1;
    if (!n) throw new Error(`the text to replace was not found in "${target}"; call get_content and copy it exactly`);
    if (n > 1 && !all) throw new Error(`the text to replace appears ${n} times in "${target}"; include more of the code around it, or set all to change every one`);
    const html = all ? code.split(old).join(next) : code.replace(old, () => next);
    ws.setContent(target, html);
    return `ok: ${all ? n : 1} change${(all ? n : 1) === 1 ? '' : 's'} in "${target}"${noFiles(html)}`;
  })) as never);

  server.registerTool('get_content', {
    description: 'Get the HTML content of one leaf/overlay, or all contents if id is omitted.',
    inputSchema: { id: id.describe('box (leaf) reference or overlay id').optional() },
  }, guard(({ id: ref }: { id?: string }) => {
    if (!ref) return JSON.stringify(ws.contents(), null, 2);
    return ws.content(boxRef(ws.load(), ref)) ?? '(no content: placeholder)';
  }) as never);

  server.registerTool('undo', { description: 'Revert the last change (layout or box code). Refused if it would change something outside the scope.' },
    guard(() => ws.transaction(() => {
      const sc = scope();
      const peek = ws.peekUndo();
      if (sc && peek?.head && sc !== ws.load().root.id) throw new Error(`refused: undoing "${peek.label}" would change the page head (theme), which is outside the scope "${sc}"`);
      if (sc && peek) {
        const cur = ws.load();
        if (peek.layout) {
          const v = scopeViolation(cur, peek.layout, sc);
          if (v) throw new Error(`refused: undoing "${peek.label}" ${v.replace(/^this change /, '')}`);
        }
        if (peek.box) assertInScope(cur, peek.box);
      }
      return `undid: ${ws.undo()}`;
    })));

  server.registerTool('redo', { description: 'Bring back the last change undone with undo. Refused if it would change something outside the scope.' },
    guard(() => ws.transaction(() => {
      const sc = scope();
      const peek = ws.peekRedo();
      if (sc && peek?.head && sc !== ws.load().root.id) throw new Error(`refused: redoing "${peek.label}" would change the page head (theme), which is outside the scope "${sc}"`);
      if (sc && peek) {
        const cur = ws.load();
        if (peek.layout) {
          const v = scopeViolation(cur, peek.layout, sc);
          if (v) throw new Error(`refused: redoing "${peek.label}" ${v.replace(/^this change /, '')}`);
        }
        if (peek.box) assertInScope(peek.layout ?? cur, peek.box);
      }
      return `redid: ${ws.redo()}`;
    })));

  server.registerTool('render', { description: 'Write out/index.html from the layout and contents; returns its path.' },
    guard(() => ws.render()));

  // ---------- the pages of a site, for a client that works on several (Claude Desktop) ----------

  const home = opts.home ? resolve(opts.home) : null;
  /** The site the server works in: the folder it was started on (a site, or an empty folder), or the site that page belongs to. */
  const siteDir = (): string | null => {
    if (!home) return null;
    if (!existsSync(join(home, 'layout.slice'))) return home;
    return siteOf(home) ? dirname(home) : null;
  };
  /** The open page's name in the site, if a page is open there. */
  const openPage = (site: string) => (ws.store instanceof FolderStore && ws.store.exists('layout.slice') && dirname(ws.dir) === site ? basename(ws.dir) : null);
  const siteOnly = () => {
    if (runScope) throw new Error('refused: this run works on one block of one page');
    const site = siteDir();
    if (!site) throw new Error('this page is not part of a site, so there are no other pages here. A site is a folder of page folders: start TYKERF on one to work on several pages');
    return site;
  };

  // a run on one block (the editor's Kaity) never sees them
  if (home && !runScope) {
    server.registerTool('list_pages', { description: 'The pages of the site (a folder of page folders), and which one is open: the one every other tool works on.' },
      guard(() => {
        const site = siteOnly();
        const pages = sitePages(site), open = openPage(site);
        if (!pages.length) return `the site ${site} has no pages yet: new_page makes the first one`;
        return `site ${site}\n${pages.map((p) => `${p}${p === open ? ' (open)' : ''}`).join('\n')}${open ? '' : '\nno page is open: open_page opens one'}`;
      }));

    server.registerTool('open_page', {
      description: 'Open another page of the site (see list_pages): every other tool then works on it. Replies with its outline.',
      inputSchema: { name: z.string().describe('page name from list_pages') },
    }, guard(({ name }: { name: string }) => {
      const site = siteOnly();
      const pages = sitePages(site);
      if (!pages.includes(name)) throw new Error(`there is no page "${name}" in the site (pages: ${pages.join(', ') || 'none yet'})`);
      ws = pageWorkspace(site, name);
      return `ok: "${name}" is open\n\n${outline(ws.load())}`;
    }));

    server.registerTool('new_page', {
      description: 'Make a new page in the site from a page layout (see list_layouts) and open it. It gets the theme given (see list_themes), unless the site\'s pages share one theme. ' +
        'Name: lowercase letters, digits and -. Links between pages are written /<name>/.',
      inputSchema: {
        name: z.string(), layout: z.string().optional().describe('layout name from list_layouts (default blank)'), theme: z.string().optional().describe(`theme preset from list_themes (default ${DEFAULT_THEME})`),
        copy: z.string().optional().describe('another page to copy instead of a layout: its blocks, code, images and (unless the pages share one) its theme'),
      },
    }, guard(({ name, layout, theme: themeName, copy }: { name: string; layout?: string; theme?: string; copy?: string }) => {
      const site = siteOnly();
      if (copy && !sitePages(site).includes(copy)) throw new Error(`there is no page "${copy}" to copy (pages: ${sitePages(site).join(', ') || 'none yet'})`);
      mkdirSync(site, { recursive: true });
      const shared = hasTheme(siteHead(site));
      ws = newSitePage(site, name, layout ?? 'blank', themeName ?? DEFAULT_THEME);
      if (copy) {
        usePage(ws, site, copy, { theme: !shared, author: 'ai' });
        return `ok: new page "${name}", a copy of "${copy}"; it is open now. Rewrite its text for this page.\n\n${outline(ws.load())}`;
      }
      const look = shared ? 'it uses the theme the site\'s pages share' : `with the ${themeName ?? DEFAULT_THEME} theme`;
      return `ok: new page "${name}" from the ${layout ?? 'blank'} layout, ${look}; it is open now. Rewrite every box's placeholder text for this page.\n\n${outline(ws.load())}`;
    }));
  }

  server.registerTool('check_page', {
    description: 'What is left unfinished in the scope block (the whole page without a scope): placeholder text and pictures from layouts and components, and links that go nowhere, to a section that is not on the page or to a page the site does not have. Run it before you answer.',
  }, guard(() => {
    const left = leftovers(ws, { within: scope() });
    return left.length ? `${left.length} left unfinished:\n${left.map(say).join('\n')}` : 'nothing left: no placeholder text or pictures, and every link has a target';
  }));

  server.registerTool('evaluate', {
    description: 'Render in headless Chromium and score: horizontal scroll, overflow, image distortion, #priority outside first screen, line length, tap targets, height, wasted space.',
    inputSchema: { widths: z.array(z.number().int()).optional() },
  }, guard(async ({ widths }: { widths?: number[] }) => {
    const { evaluateHTML } = await import('../metrics.js');
    const r = await evaluateHTML(ws.page(), { widths });
    return JSON.stringify(r, null, 2);
  }) as never);

  server.registerTool('screenshot', {
    description: 'Look at the page: a PNG of one block (with a dashed red frame and a little context around it) or of the whole page, at a viewport width. ' +
      'Defaults to the scope block if one is set. Use it to check how a change looks, not only the metrics.',
    inputSchema: { id: id.optional().describe('block to look at; default: the scope, else the whole page'), width: z.number().int().min(320).max(2560).optional().describe('viewport width in px (default 1440; 375 = phone)') },
  }, (async (raw: { id?: string; width?: number }) => {
    try {
      const l = ws.load();
      const target = raw.id ? resolveRef(l, raw.id) : scope(l);
      const { screenshot } = await import('../screenshot.js');
      const shot = await screenshot(ws.page(), { width: raw.width ?? 1440, id: target && target !== l.root.id ? target : null });
      const what = shot.box ? `${pathOf(l, target!)}: ${Math.round(shot.box.w)}×${Math.round(shot.box.h)} px (dashed red frame), with 24 px around it` : 'the whole page';
      return {
        content: [
          { type: 'image' as const, data: shot.png.toString('base64'), mimeType: 'image/png' },
          { type: 'text' as const, text: `${what} at ${shot.width} px wide${shot.cropped ? '; cut at 2000 px tall, look at smaller blocks to see the rest' : ''}.` },
        ],
      };
    } catch (e) {
      return text(`error: ${(e as Error).message}`, true);
    }
  }) as never);

  return server;
}
