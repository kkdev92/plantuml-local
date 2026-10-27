import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { drawnTitle } from '../../src/render/title';

const fixture = (name: string): string => readFileSync(join(__dirname, 'fixtures/engine-output', name), 'utf8');

describe('drawnTitle', () => {
  it('reads the title as the engine drew it, without the markup of its source', () => {
    // title <u>Simple</u> **order** flow
    expect(drawnTitle(fixture('title-markup.svg'))).toBe('Simple order flow');
    // title, then "Order" and "<b>flow</b>" on lines of their own, then end title
    expect(drawnTitle(fixture('title-lines.svg'))).toBe('Order flow');
    // title a < b & c "q" 'x'
    expect(drawnTitle(fixture('title-escaped.svg'))).toBe('a < b & c "q" \'x\'');
  });

  it('reads no title from a diagram that draws none, nor from an error the engine drew', () => {
    expect(drawnTitle(fixture('sequence.svg'))).toBeNull();
    expect(drawnTitle(fixture('syntax-error.svg'))).toBeNull();
    expect(drawnTitle('')).toBeNull();
  });

  it('reads the texts of the title group only, wherever its groups end', () => {
    const svg = [
      '<svg><g><g class="title">',
      '<text x="1" y="10">Left</text><g><text x="40" y="10"> part</text></g>',
      '<g/><text x="1" y="24">second  line</text>',
      '</g><text x="1" y="50">Participant</text></g></svg>',
    ].join('');

    expect(drawnTitle(svg)).toBe('Left part second line');
  });

  it('reads nothing from a title group without text', () => {
    expect(drawnTitle('<svg><g class="title"/><text y="1">A</text></svg>')).toBeNull();
    expect(drawnTitle('<svg><g class="title"><text y="1">  </text><line x1="0"/></g><text y="9">A</text></svg>')).toBeNull();
  });
});
