import { describe, expect, it } from 'vitest';

import { lineAfterEdits, planReferenceEdits, type ReferenceEdit } from '../../src/export/references';

const md = (...lines: string[]): string => lines.join('\n');
const exported = (...names: string[]): Set<string> => new Set(names);

/** Applies edits the way the extension does: line-based, back to front. */
function apply(text: string, edits: readonly ReferenceEdit[]): string {
  const lines = text.split('\n');
  for (const edit of [...edits].sort((a, b) => b.line - a.line)) {
    if (edit.kind === 'replace-line') {
      lines[edit.line] = edit.text;
    } else {
      lines[edit.line] = `${lines[edit.line] ?? ''}${edit.text}`;
    }
  }
  return lines.join('\n');
}

const BLOCK = ['```plantuml orders', '@startuml', 'A -> B', '@enduml', '```'];

describe('planReferenceEdits', () => {
  it('inserts a marked reference after the closing fence', () => {
    const text = md('# doc', '', ...BLOCK, '', 'after');
    const edits = planReferenceEdits(text, exported('orders'), 'images');

    expect(edits).toHaveLength(1);
    expect(apply(text, edits)).toBe(
      md('# doc', '', ...BLOCK, '', '![orders](images/orders.svg#plantuml-local)', '', 'after')
    );
  });

  it('is idempotent: planning against its own output yields no edits', () => {
    const text = md(...BLOCK, '', 'body');
    const once = apply(text, planReferenceEdits(text, exported('orders'), 'images'));

    expect(planReferenceEdits(once, exported('orders'), 'images')).toEqual([]);
  });

  it('adds a separating blank line when content follows the fence directly', () => {
    const text = md(...BLOCK, 'body right here');
    const result = apply(text, planReferenceEdits(text, exported('orders'), 'images'));

    expect(result).toBe(
      md(...BLOCK, '', '![orders](images/orders.svg#plantuml-local)', '', 'body right here')
    );
  });

  it('inserts at end of file without trailing padding', () => {
    const text = md(...BLOCK);
    const result = apply(text, planReferenceEdits(text, exported('orders'), 'images'));

    expect(result).toBe(md(...BLOCK, '', '![orders](images/orders.svg#plantuml-local)'));
  });

  it('rewrites a managed line whose name or directory moved', () => {
    // The block was renamed after the reference was inserted.
    const text = md(...BLOCK, '', '![old-name](images/old-name.svg#plantuml-local)');
    const edits = planReferenceEdits(text, exported('orders'), 'images');

    expect(edits).toEqual([
      {
        kind: 'replace-line',
        line: 6,
        text: '![orders](images/orders.svg#plantuml-local)',
      },
    ]);
  });

  it('rewrites managed lines when the export directory changes', () => {
    const text = md(...BLOCK, '', '![orders](images/orders.svg#plantuml-local)');
    const edits = planReferenceEdits(text, exported('orders'), 'diagrams/out');

    expect(apply(text, edits)).toContain('![orders](diagrams/out/orders.svg#plantuml-local)');
  });

  it('leaves a hand-written reference to the same file alone', () => {
    // No marker, but it already shows this very diagram; inserting a
    // managed line above it would render the image twice on GitHub.
    const text = md(...BLOCK, '', '![my caption](images/orders.svg)');

    expect(planReferenceEdits(text, exported('orders'), 'images')).toEqual([]);
  });

  it('does not treat an inline image inside prose as the reference', () => {
    const text = md(...BLOCK, '', 'see ![orders](images/orders.svg#plantuml-local) inline');
    const edits = planReferenceEdits(text, exported('orders'), 'images');

    expect(edits).toHaveLength(1);
    expect(edits[0]?.kind).toBe('insert-after');
  });

  it('only references blocks that were actually exported', () => {
    const text = md(...BLOCK, '', '```plantuml failed', 'x', '```');

    const edits = planReferenceEdits(text, exported('orders'), 'images');
    expect(edits).toHaveLength(1);
    expect(apply(text, edits)).not.toContain('failed.svg');
  });

  it('handles adjacent blocks, inserting between the fences', () => {
    const text = md('```plantuml one', 'a', '```', '```plantuml two', 'b', '```');
    const result = apply(text, planReferenceEdits(text, exported('one', 'two'), 'images'));

    expect(result).toBe(
      md(
        '```plantuml one',
        'a',
        '```',
        '',
        '![one](images/one.svg#plantuml-local)',
        '',
        '```plantuml two',
        'b',
        '```',
        '',
        '![two](images/two.svg#plantuml-local)'
      )
    );
  });

  it('uses the angle-bracket form when the path contains spaces', () => {
    const text = md(...BLOCK);
    const result = apply(text, planReferenceEdits(text, exported('orders'), 'my diagrams'));

    // CommonMark cannot parse a bare destination containing spaces.
    expect(result).toContain('![orders](<my diagrams/orders.svg#plantuml-local>)');
  });

  it('recognises its own angle-bracket form when re-planning', () => {
    const text = md(...BLOCK, '', '![orders](<my diagrams/orders.svg#plantuml-local>)');

    expect(planReferenceEdits(text, exported('orders'), 'my diagrams')).toEqual([]);
  });

  it('references a block in a block quote or a nested list only once that is supported', () => {
    // Exported like any other block, but a reference line there needs the
    // container's markers, so for now none is planned.
    const quoted = md('> ```plantuml quoted', '> @startuml', '> A -> B', '> @enduml', '> ```', '', 'after');
    const nested = md('1. item', '', '    ```plantuml nested', '    @startuml', '    @enduml', '    ```');
    expect(planReferenceEdits(quoted, exported('quoted'), 'images')).toEqual([]);
    expect(planReferenceEdits(nested, exported('nested'), 'images')).toEqual([]);
  });

  it('writes next to the document when the directory is "."', () => {
    const text = md(...BLOCK);
    const result = apply(text, planReferenceEdits(text, exported('orders'), '.'));

    expect(result).toContain('![orders](orders.svg#plantuml-local)');
  });
});

describe('lineAfterEdits', () => {
  // A reference inserted with a separating blank line (content follows the
  // fence), a block that failed and gets none, a managed line rewritten in
  // place, and a reference inserted at the end of the file.
  const text = md(
    '# doc',
    ...BLOCK,
    'prose right after the fence',
    '',
    '```plantuml failed',
    '@startuml',
    'this is not valid ;;; [[[',
    '@enduml',
    '```',
    '',
    '```plantuml renamed',
    'A -> B',
    '```',
    '',
    '![old](images/old.svg#plantuml-local)',
    '',
    '```plantuml last',
    'A -> B',
    '```'
  );
  const edits = planReferenceEdits(text, exported('orders', 'renamed', 'last'), 'images');

  it('follows every line of the planned-from text into the edited text', () => {
    expect(edits.map((edit) => edit.kind)).toEqual(['insert-after', 'replace-line', 'insert-after']);
    const before = text.split('\n');
    const after = apply(text, edits).split('\n');

    for (const [index, content] of before.entries()) {
      const replaced = edits.find((edit) => edit.kind === 'replace-line' && edit.line === index);
      const moved = lineAfterEdits(edits, index + 1);
      expect(after[moved - 1], `line ${String(index + 1)}`).toBe(replaced?.text ?? content);
    }
  });

  it('moves a failed block down by the lines inserted above it', () => {
    const broken = text.split('\n').indexOf('this is not valid ;;; [[[') + 1;

    // The reference after `orders`, its blank line, and the blank line
    // that separates it from the prose.
    expect(lineAfterEdits(edits, broken)).toBe(broken + 3);
    expect(lineAfterEdits([], broken)).toBe(broken);
  });
});
