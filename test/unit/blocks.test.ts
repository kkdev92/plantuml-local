import { describe, expect, it } from 'vitest';

import { blockAtLine, findPlantUmlBlocks, isValidBlockName } from '../../src/export/blocks';

const md = (...lines: string[]): string => lines.join('\n');

describe('findPlantUmlBlocks', () => {
  it('finds a plain block and strips the fences', () => {
    const blocks = findPlantUmlBlocks(
      md('# Title', '', '```plantuml', '@startuml', 'A -> B', '@enduml', '```', '', 'after')
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.source).toBe('@startuml\nA -> B\n@enduml');
    expect(blocks[0]?.name).toBeNull();
    expect(blocks[0]?.openLine).toBe(2);
    expect(blocks[0]?.closeLine).toBe(6);
  });

  it('reads the name from the info string', () => {
    const blocks = findPlantUmlBlocks(md('```plantuml orders-api', '@startuml', '@enduml', '```'));
    expect(blocks[0]?.name).toBe('orders-api');
  });

  it('ignores anything after the name', () => {
    const blocks = findPlantUmlBlocks(md('```plantuml orders  extra stuff', 'x', '```'));
    expect(blocks[0]?.name).toBe('orders');
  });

  it('skips fences in other languages', () => {
    const blocks = findPlantUmlBlocks(
      md('```js', 'const a = 1;', '```', '', '```plantuml', 'x', '```')
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.source).toBe('x');
  });

  it('does not mistake a plantuml example inside another fence for a diagram', () => {
    // A README showing the syntax must not export the example.
    const blocks = findPlantUmlBlocks(
      md('````markdown', '```plantuml', '@startuml', '@enduml', '```', '````')
    );
    expect(blocks).toHaveLength(0);
  });

  it('handles a longer fence closing only on an equal or longer one', () => {
    const blocks = findPlantUmlBlocks(md('````plantuml', '```', 'still inside', '````'));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.source).toBe('```\nstill inside');
  });

  it('handles tilde fences', () => {
    const blocks = findPlantUmlBlocks(md('~~~plantuml', '@startuml', '~~~'));
    expect(blocks[0]?.source).toBe('@startuml');
  });

  it('does not close a tilde fence on backticks', () => {
    const blocks = findPlantUmlBlocks(md('~~~plantuml', '```', 'inside', '~~~'));
    expect(blocks[0]?.source).toBe('```\ninside');
  });

  it('accepts an indented fence and de-indents the content', () => {
    // Fences inside a list item are indented.
    const blocks = findPlantUmlBlocks(md('  ```plantuml', '  @startuml', '  A -> B', '  ```'));
    expect(blocks[0]?.source).toBe('@startuml\nA -> B');
  });

  it('runs an unclosed fence to the end of the document', () => {
    const blocks = findPlantUmlBlocks(md('```plantuml', '@startuml', 'A -> B'));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.source).toBe('@startuml\nA -> B');
  });

  it('finds several blocks in order', () => {
    const blocks = findPlantUmlBlocks(
      md('```plantuml one', 'a', '```', '', '```plantuml two', 'b', '```')
    );
    expect(blocks.map((b) => b.name)).toEqual(['one', 'two']);
  });

  it('handles CRLF line endings', () => {
    const blocks = findPlantUmlBlocks('```plantuml\r\n@startuml\r\nA -> B\r\n```\r\n');
    expect(blocks[0]?.source).toBe('@startuml\nA -> B');
  });

  it('returns nothing for a document without diagrams', () => {
    expect(findPlantUmlBlocks(md('# Title', '', 'Just prose.'))).toEqual([]);
  });
});

describe('blockAtLine', () => {
  const blocks = findPlantUmlBlocks(
    md('intro', '```plantuml a', 'x', '```', 'between', '```plantuml b', 'y', '```')
  );

  it('finds the block containing the cursor', () => {
    expect(blockAtLine(blocks, 2)?.name).toBe('a');
    expect(blockAtLine(blocks, 6)?.name).toBe('b');
  });

  it('counts the fence lines as inside the block', () => {
    expect(blockAtLine(blocks, 1)?.name).toBe('a');
    expect(blockAtLine(blocks, 3)?.name).toBe('a');
  });

  it('returns null outside every block', () => {
    expect(blockAtLine(blocks, 0)).toBeNull();
    expect(blockAtLine(blocks, 4)).toBeNull();
  });
});

describe('isValidBlockName', () => {
  it('accepts letters, digits, hyphens and underscores', () => {
    for (const name of ['a', 'orders-api', 'Order_2', 'A1']) {
      expect(isValidBlockName(name), name).toBe(true);
    }
  });

  it('rejects anything that could escape the export directory', () => {
    // These become file names, so a separator or a traversal must not pass.
    for (const name of ['', '..', 'a/b', 'a\\b', 'a.svg', 'a b', 'C:', '日本語']) {
      expect(isValidBlockName(name), name).toBe(false);
    }
  });

  it('rejects Windows device names, whatever their case', () => {
    // `nul.svg` opens the null device: the export would claim success and
    // leave no file behind.
    for (const name of ['nul', 'NUL', 'Con', 'prn', 'aux', 'com1', 'LPT9']) {
      expect(isValidBlockName(name), name).toBe(false);
    }
  });

  it('still accepts names that merely start like a device name', () => {
    for (const name of ['console', 'nullable', 'com10', 'aux-service']) {
      expect(isValidBlockName(name), name).toBe(true);
    }
  });
});
