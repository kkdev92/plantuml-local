import { describe, expect, it } from 'vitest';

import { blockAtLine, findFileDiagrams, findPlantUmlBlocks, isProseLine, isValidBlockName } from '../../src/export/blocks';

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

  it('records the document line the source begins on', () => {
    const blocks = findPlantUmlBlocks(md('# Title', '```plantuml', '@startuml', '@enduml', '```'));
    expect(blocks[0]?.sourceLine).toBe(2);
  });

  it('accounts for blank lines trimmed from the start of the source', () => {
    // Line n of `source` must map back to its own document line, so the
    // engine's line numbers can be reported against the document.
    const blocks = findPlantUmlBlocks(md('```plantuml', '', '  ', '@startuml', 'A -> B', '@enduml', '```'));
    expect(blocks[0]?.source.split('\n')[0]).toBe('@startuml');
    expect(blocks[0]?.sourceLine).toBe(3);
  });

  it('puts the source line right after the fence when the block is blank', () => {
    const blocks = findPlantUmlBlocks(md('intro', '```plantuml', '', '```'));
    expect(blocks[0]?.source).toBe('');
    expect(blocks[0]?.sourceLine).toBe(2);
  });

  it('returns nothing for a document without diagrams', () => {
    expect(findPlantUmlBlocks(md('# Title', '', 'Just prose.'))).toEqual([]);
  });

  it('finds the blocks the preview draws, in quotes and lists too, and only those', () => {
    const blocks = findPlantUmlBlocks(
      md(
        '```plantuml top', '@startuml', 'A -> B', '@enduml', '```',
        '',
        '> quoted', '>', '> ```plantuml quoted', '> @startuml', '> A -> B', '> @enduml', '> ```',
        '',
        '- item', '', '  ```plantuml listed', '  @startuml', '  A -> B', '  @enduml', '  ```',
        '',
        '1. ordered', '', '    ```plantuml deeplisted', '    @startuml', '    A -> B', '    @enduml', '    ```',
        '',
        '```puml alias', '@startuml', 'A -> B', '@enduml', '```',
        '',
        '~~~plantuml tilde', '@startuml', 'A -> B', '@enduml', '~~~',
        '',
        '````markdown', '```plantuml inside-other-fence', '@startuml', '@enduml', '```', '````',
        '',
        '<!--', '```plantuml in-html-comment', '@startuml', 'A -> B', '@enduml', '```', '-->'
      )
    );

    expect(blocks.map((b) => [b.name, b.container, b.closed])).toEqual([
      ['top', '', true],
      ['quoted', '> ', true],
      ['listed', '  ', true],
      ['deeplisted', '    ', true],
      ['alias', '', true],
      ['tilde', '', true],
    ]);
    for (const block of blocks) {
      expect(block.source, String(block.name)).toBe('@startuml\nA -> B\n@enduml');
    }
    expect(blocks[1]?.openLine).toBe(8);
    expect(blocks[1]?.sourceLine).toBe(9);
    expect(blocks[1]?.closeLine).toBe(12);
  });

  it('turns list markers into spaces in the container, and tells an unclosed fence', () => {
    const blocks = findPlantUmlBlocks(
      md('- ```plantuml marker', '  @startuml', '  ```', '', '> 1. ```plantuml both', '>    @startuml', '>    ```', '', '```plantuml open', '@startuml')
    );
    expect(blocks.map((b) => [b.name, b.container, b.closed])).toEqual([
      ['marker', '  ', true],
      ['both', '>    ', true],
      ['open', '', false],
    ]);
  });

  it('takes only plantuml and puml, exactly', () => {
    for (const info of ['PlantUML', 'uml', 'plantuml-x', 'pumlx']) {
      expect(findPlantUmlBlocks(md(`\`\`\`${info}`, '@startuml', '@enduml', '```')), info).toEqual([]);
    }
  });

  it('skips front matter as the preview does, keeping line numbers', () => {
    const blocks = findPlantUmlBlocks(
      md('---', 'title: x', '```plantuml in-front-matter', '---', '', '```plantuml body', '@startuml', '@enduml', '```')
    );
    expect(blocks.map((b) => b.name)).toEqual(['body']);
    expect(blocks[0]?.openLine).toBe(5);
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

describe('isProseLine', () => {
  const doc = md(
    '---', // 0
    'title: x', // 1
    '---', // 2
    'text', // 3
    '```js', // 4
    'code', // 5
    '```', // 6
    '<!--', // 7
    'comment', // 8
    '-->', // 9
    '> quoted', // 10
    '```plantuml', // 11
    '@startuml', // 12
    '```', // 13
    '' // 14
  );

  it('is true for the text the preview shows, quotes included', () => {
    for (const line of [3, 10, 14]) {
      expect(isProseLine(doc, line), String(line)).toBe(true);
    }
  });

  it('is false in front matter, code blocks and HTML blocks', () => {
    for (const line of [0, 1, 2, 4, 5, 6, 7, 8, 9, 11, 12, 13]) {
      expect(isProseLine(doc, line), String(line)).toBe(false);
    }
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

  it('accepts up to 128 characters', () => {
    // A file name has room for 255 on most file systems; the export writes
    // a temporary file whose name is longer than the final one.
    expect(isValidBlockName('a'.repeat(128))).toBe(true);
    expect(isValidBlockName('a'.repeat(129))).toBe(false);
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

describe('findFileDiagrams', () => {
  it('takes a file with one diagram as one block, named after the file', () => {
    const diagrams = findFileDiagrams(md("' a comment", '@startuml', 'A -> B', '@enduml', ''), 'orders');

    expect(diagrams).toEqual([
      {
        name: 'orders',
        source: '@startuml\nA -> B\n@enduml',
        sourceLine: 1,
        openLine: 1,
        closeLine: 3,
        container: '',
        closed: true,
      },
    ]);
  });

  it('names each diagram of a longer file by its id, and leaves the rest unnamed', () => {
    const diagrams = findFileDiagrams(
      md(
        '@startuml(id=orders)',
        'A -> B',
        '@enduml',
        'text between diagrams is not read',
        '@startuml',
        'C -> D',
        '@enduml',
        '@startmindmap(id=map)',
        '* root',
        '@endmindmap'
      ),
      'flows'
    );

    expect(diagrams.map((d) => [d.name, d.openLine, d.closeLine])).toEqual([
      ['orders', 0, 2],
      [null, 4, 6],
      ['map', 7, 9],
    ]);
    expect(diagrams[2]?.source).toBe('@startmindmap(id=map)\n* root\n@endmindmap');
  });

  it('reads an id only right after the start, and keeps one that cannot be a file name', () => {
    const diagrams = findFileDiagrams(
      md('@startuml (id=spaced)', '@enduml', '@startuml(id=a b)', '@enduml'),
      'flows'
    );

    // The exporter refuses the second rather than finding it unnamed.
    expect(diagrams.map((d) => d.name)).toEqual([null, 'a b']);
  });

  it('skips start lines in comments, as the engine does', () => {
    const diagrams = findFileDiagrams(
      md("' @startuml(id=commented)", "/'", '@startuml(id=hidden)', "'/", '@startuml', 'A -> B', '@enduml'),
      'flows'
    );

    expect(diagrams.map((d) => [d.name, d.openLine])).toEqual([['flows', 4]]);
  });

  it('runs a diagram without an end line up to the next start, or the end of the file', () => {
    const diagrams = findFileDiagrams(
      md('@startuml(id=one)', 'A -> B', '@startuml(id=two)', 'C -> D'),
      'flows'
    );

    expect(diagrams.map((d) => [d.name, d.openLine, d.closeLine, d.closed])).toEqual([
      ['one', 0, 1, false],
      ['two', 2, 3, false],
    ]);
  });

  it('takes a file without a start line as one diagram, and an empty one as none', () => {
    expect(findFileDiagrams(md('Alice -> Bob', ''), 'loose').map((d) => [d.name, d.source])).toEqual([
      ['loose', 'Alice -> Bob\n'],
    ]);
    expect(findFileDiagrams(md('', "' only a comment", ''), 'empty')).toEqual([]);
  });
});
