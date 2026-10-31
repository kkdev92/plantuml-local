import { describe, expect, it } from 'vitest';

import { readStyleNames } from '../../scripts/style-names.mjs';

/**
 * A script laid out as the engine's plantuml.js is: its strings in one
 * array, loaded by `(strings) => …` and read by `(index) => …`, and the
 * constants of each enum made by one function from a string and an ordinal.
 * test/integration/worker.test.ts holds the catalogue to the names read
 * from the real one.
 */
const engine = (...enums: string[][]): string => {
  const strings = enums.flat();
  let index = 0;
  const made = enums.map((names, which) =>
    names.map((_, ordinal) => `$c${which}_${ordinal}=Mk${which}(Rd(${String(index++)}),${String(ordinal)});`).join('')
  );
  return [
    'let Pool,Load=strings=>{let i;Pool=new Array(strings.length);for(i=0;i<strings.length;i++){Pool[i]=strings[i];}},',
    'Rd=index=>Pool[index];',
    `Load([${strings.map((name) => JSON.stringify(name)).join(',\n')}]);`,
    'Other(Rd(0),7);',
    ...made,
  ].join('\n');
};

const PROPERTIES = ['FontName', 'FontColor', 'BackGroundColor', 'LineThickness'];
const SELECTORS = ['root', 'element', 'sequenceDiagram', 'participant', 'classDiagram', 'class_'];

describe('readStyleNames', () => {
  it('reads the constants of the two enums of style names, in their order', () => {
    expect(readStyleNames(engine(['A', 'B'], PROPERTIES, SELECTORS))).toEqual({
      properties: PROPERTIES,
      selectors: SELECTORS,
    });
  });

  it('stops when the script is laid out otherwise, rather than offer nothing', () => {
    expect(() => readStyleNames('const names = ["FontName"];')).toThrow('no string pool found');
    expect(() => readStyleNames(engine(PROPERTIES, ['root']))).toThrow('0 lists of style selectors found');
    expect(() => readStyleNames(engine(PROPERTIES, SELECTORS, SELECTORS))).toThrow('2 lists of style selectors found');
  });
});
