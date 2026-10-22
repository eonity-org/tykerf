// Types for inline.js (plain browser JS, no build), so the tests can use its helpers from TypeScript.

export interface Rect { x: number; y: number; w: number; h: number }

export function elementPath(el: Element, root: Element): number[] | null;
export function atPath(root: Element | DocumentFragment, path: number[]): Element | null;
export function inlineOnly(el: Element): boolean;
export function editableAt(target: Node | null, root: Element): Element | null;
export function sameElement(page: Element | null, code: Element | null): boolean;
export function sameImage(page: Element | null, code: Element | null): boolean;
export function safeHref(href: string): boolean;
export function cleanInline(el: Element, known?: WeakSet<Node>): string;

export function fitAspect(W: number, H: number, aspect: number | null): Rect;
export function turned(w: number, h: number, quarter: number): { w: number; h: number };
export function resizeCrop(r: Rect, handle: string, dx: number, dy: number, aspect: number | null, W: number, H: number, min?: number): Rect;
export function moveCrop(r: Rect, dx: number, dy: number, W: number, H: number): Rect;
export function outputSize(w: number, h: number, max: number | null): { w: number; h: number; k: number };
