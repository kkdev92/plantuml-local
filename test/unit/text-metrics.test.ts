import { describe, expect, it } from 'vitest';

import { createCanvas2DContextStub, measureTextWidth } from '../../src/worker/text-metrics';

describe('measureTextWidth', () => {
  it('scales with the font size', () => {
    const at14 = measureTextWidth('Hello', 14);
    const at28 = measureTextWidth('Hello', 28);
    expect(at28).toBeCloseTo(at14 * 2, 6);
  });

  it('treats CJK and kana as full-width', () => {
    // CJK fixture characters are required to exercise the full-width branch.
    expect(measureTextWidth('あ', 14)).toBe(14);
    expect(measureTextWidth('日本語ラベル', 14)).toBe(6 * 14);
  });

  it('gives narrow characters less width than wide ones', () => {
    expect(measureTextWidth('i', 14)).toBeLessThan(measureTextWidth('W', 14));
  });

  it('measures the empty string as zero', () => {
    expect(measureTextWidth('', 14)).toBe(0);
  });
});

describe('createCanvas2DContextStub', () => {
  it('honours the font size assigned via the font property', () => {
    const context = createCanvas2DContextStub();

    context.font = 'bold 20px sans-serif';
    const at20 = context.measureText('abc');

    context.font = '10px sans-serif';
    const at10 = context.measureText('abc');

    expect(at20.width).toBeCloseTo(at10.width * 2, 6);
    expect(at20.actualBoundingBoxAscent).toBe(15);
    expect(at20.actualBoundingBoxDescent).toBe(5);
  });

  it('keeps the previous size when the font string has no pixel value', () => {
    const context = createCanvas2DContextStub();
    context.font = '18px serif';
    context.font = 'sans-serif';
    expect(context.font).toBe('18px sans-serif');
  });
});
