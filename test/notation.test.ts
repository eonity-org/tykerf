import { describe, expect, it } from 'vitest';
import { validate } from '../src/model.js';
import { NotationError, normalize, parse, parseSlice, serialize, serializeSlice } from '../src/notation.js';

const roundTrip = (s: string) => serialize(parse(s));

describe('parse/serialize', () => {
  it('round-trips binary floorplanning expressions', () => {
    for (const s of ['1 2 H', '11 12 13 14 V V V 2 H', '29 20 21 H 24 V H 7 V']) expect(roundTrip(s)).toBe(s);
  });

  it('round-trips n-ary operators, attributes, W and P', () => {
    const s = 'logo[role=header #dark] nav cta V3{1:3:1 gap=8 align=center} hero[role=main #priority shape=text:400|image:1.5 variant=1 minw=320] H@page{#main}';
    expect(roundTrip(s)).toBe(s);
    expect(roundTrip('a b c d e W{1:2:1}')).toBe('a b c d e W{1:2:1}');
    expect(roundTrip('top _ body _ foot P')).toBe('top _ body _ foot P');
  });

  it('round-trips maxw on leaves and operators', () => {
    expect(roundTrip('a[maxw=600] b H{maxw=960 gap=8}')).toBe('a[maxw=600] b H{gap=8 maxw=960}');
  });

  it('round-trips the file format with op ids and overlays', () => {
    const text = 'a b V@o1 c H@o2\noverlay modal on o1 anchor=bottom-right z=20\n';
    const l = parseSlice(text);
    expect(serializeSlice(l)).toBe(text);
    expect(l.root.type === 'op' && l.root.named).toBe(false); // o\d+ ids stay "auto"
  });

  it('rejects malformed expressions with useful errors', () => {
    expect(() => parse('1 H')).toThrow(/needs 2 operands but only 1/);
    expect(() => parse('1 2 3 V')).toThrow(/leaves 2 subtrees/);
    expect(() => parse('1 2 3 W')).toThrow(/needs 5 operands/);
    expect(() => parse('a[foo=1] b H')).toThrow(NotationError);
    expect(() => parse('a b V{1:2')).toThrow(/unclosed/);
  });

  it('validation catches structural problems the grammar allows', () => {
    expect(validate({ root: parse('a a H'), overlays: [] }).errors[0]).toMatch(/duplicate/);
    expect(validate({ root: parse('a _ H'), overlays: [] }).ok).toBe(false);
    expect(validate({ root: parse('a b V{1:2:3}'), overlays: [] }).ok).toBe(false);
  });
});

describe('normalize', () => {
  it('merges unratioed chains into an equal n-ary split', () => {
    expect(serialize(normalize(parse('11 12 13 14 V V V 2 H')))).toBe('11 12 13 14 V4 2 H');
    expect(serialize(normalize(parse('1 2 V 3 4 V V')))).toBe('1 2 3 4 V4');
  });

  it('composes ratios so geometry is preserved', () => {
    // (1|2 at 1:1) takes 2/3, 3 takes 1/3 -> 1:1:1 ... and with an unequal inner split:
    expect(serialize(normalize(parse('1 2 V 3 V{2:1}')))).toBe('1 2 3 V3');
    expect(serialize(normalize(parse('1 2 V{3:1} 3 V{2:1}')))).toBe('1 2 3 V3{3:1:2}');
  });

  it('keeps named, tagged and differently-spaced operators as boundaries', () => {
    expect(serialize(normalize(parse('1 2 V@nav 3 V')))).toBe('1 2 V@nav 3 V');
    expect(serialize(normalize(parse('1 2 V{#dark} 3 V')))).toBe('1 2 V{#dark} 3 V');
    expect(serialize(normalize(parse('1 2 V{gap=8} 3 V')))).toBe('1 2 V{gap=8} 3 V');
  });

  it('is idempotent', () => {
    for (const s of ['11 12 13 14 V V V 2 H', '1 2 V{3:1} 3 V{2:1} 4 5 H H 6 H', 'a b H c d H V e f g h W']) {
      const once = normalize(parse(s));
      expect(serialize(normalize(once))).toBe(serialize(once));
    }
  });
});
