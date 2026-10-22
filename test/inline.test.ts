// The image tool's crop maths (src/editor/public/inline.js; these helpers don't touch the DOM).
import { describe, expect, it } from 'vitest';
import { fitAspect, moveCrop, outputSize, resizeCrop, turned } from '../src/editor/public/inline.js';

const r = { x: 100, y: 100, w: 200, h: 100 };

describe('crop frames', () => {
  it('fit an aspect in the middle of the image', () => {
    expect(fitAspect(400, 200, 1)).toEqual({ x: 100, y: 0, w: 200, h: 200 });
    expect(fitAspect(400, 200, null)).toEqual({ x: 0, y: 0, w: 400, h: 200 });
  });

  it('change only the width or only the height when an edge is dragged', () => {
    expect(resizeCrop(r, 'e', 50, 30, null, 1000, 1000)).toEqual({ x: 100, y: 100, w: 250, h: 100 });
    expect(resizeCrop(r, 'w', -50, 0, null, 1000, 1000)).toEqual({ x: 50, y: 100, w: 250, h: 100 });
    expect(resizeCrop(r, 'n', 0, -40, null, 1000, 1000)).toEqual({ x: 100, y: 60, w: 200, h: 140 });
    expect(resizeCrop(r, 's', 0, 40, null, 1000, 1000)).toEqual({ x: 100, y: 100, w: 200, h: 140 });
  });

  it('keep their aspect from an edge too, and stay inside the image', () => {
    expect(resizeCrop(r, 'e', 100, 0, 2, 1000, 1000)).toEqual({ x: 100, y: 100, w: 300, h: 150 });
    expect(resizeCrop(r, 'e', 5000, 0, null, 1000, 1000)).toEqual({ x: 100, y: 100, w: 900, h: 100 });
    expect(resizeCrop(r, 'se', 5000, 5000, 2, 1000, 400)).toEqual({ x: 100, y: 100, w: 600, h: 300 });
    expect(resizeCrop(r, 'nw', 500, 500, null, 1000, 1000).w).toBe(16);
    expect(moveCrop(r, -500, 5000, 1000, 400)).toEqual({ x: 0, y: 300, w: 200, h: 100 });
  });

  it('turn and scale down', () => {
    expect(turned(300, 200, 1)).toEqual({ w: 200, h: 300 });
    expect(outputSize(3000, 1500, 1200)).toEqual({ w: 1200, h: 600, k: 0.4 });
    expect(outputSize(800, 400, 1200)).toEqual({ w: 800, h: 400, k: 1 });
  });
});
