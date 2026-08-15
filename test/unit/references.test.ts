import { describe, expect, it } from 'vitest';

import { planReferenceEdits, type ReferenceEdit } from '../../src/export/references';

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

  it('writes next to the document when the directory is "."', () => {
    const text = md(...BLOCK);
    const result = apply(text, planReferenceEdits(text, exported('orders'), '.'));

    expect(result).toContain('![orders](orders.svg#plantuml-local)');
  });
});
