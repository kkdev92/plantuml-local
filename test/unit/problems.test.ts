import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { checkSource, PROBLEM_CODES, renderProblems, type ProblemLabels } from '../../src/diagnostics/problems';
import { findPlantUmlBlocks, type PlantUmlBlock } from '../../src/export/blocks';

const LABELS: ProblemLabels = {
  remoteReference: 'remote',
  severalDiagrams: 'several',
  pages: 'pages',
  missingEnd: (end) => `no ${end}`,
  localFile: 'no files',
  themeFrom: 'bundled themes only',
  libraryNotBundled: (library) => `${library} not bundled`,
  emojiUnavailable: 'emoji',
  tooLarge: 'too large',
};

/** The only block of a document whose block starts on line 2 (after a title and a blank line). */
function blockOf(...source: string[]): PlantUmlBlock {
  const [block] = findPlantUmlBlocks(['# Doc', '', '```plantuml', ...source, '```'].join('\n'));
  if (block === undefined) throw new Error('no block');
  return block;
}

/** What the bundled engine returned for a source (see engine-error.test.ts). */
function engineOutput(name: string): string {
  return readFileSync(join(__dirname, 'fixtures/engine-output', `${name}.svg`), 'utf8');
}

/** The engine's error layout, for messages no fixture holds. */
function errorImage(line: number, message: string): string {
  return (
    '<svg><text font-style="italic">PlantUML version 1</text>' +
    `<text>[From textarea (line ${String(line)}) ]</text><text fill="#FF0000">${message}</text></svg>`
  );
}

describe('checkSource', () => {
  it('finds nothing in a well-formed diagram and renders it as it is', () => {
    const block = blockOf('@startuml', 'Alice -> Bob', '@enduml');
    expect(checkSource(block, LABELS)).toEqual({ problems: [], render: block.source, startLine: 3 });
  });

  it('refuses what the preview refuses, on the line that causes it', () => {
    const remote = checkSource(blockOf('@startuml', '!include https://example.com/x.puml', '@enduml'), LABELS);
    expect(remote.problems).toEqual([{ line: 4, severity: 'error', code: PROBLEM_CODES.CAP001, message: 'remote' }]);
    expect(remote.render).toBeNull();

    const several = checkSource(blockOf('@startuml', 'A -> B', '@enduml', '@startuml', 'C -> D', '@enduml'), LABELS);
    expect(several.problems).toEqual([{ line: 6, severity: 'error', code: PROBLEM_CODES.DOC003, message: 'several' }]);

    const pages = checkSource(blockOf('@startuml', 'A -> B', 'newpage', 'C -> D', '@enduml'), LABELS);
    expect(pages.problems).toEqual([{ line: 5, severity: 'error', code: PROBLEM_CODES.CAP001, message: 'pages' }]);
  });

  it('warns about what is drawn anyway: a missing end line', () => {
    const check = checkSource(blockOf('@startuml', 'Alice -> Bob'), LABELS);
    expect(check.problems).toEqual([
      { line: 3, severity: 'warning', code: PROBLEM_CODES.DOC002, message: 'no @enduml' },
    ]);
    expect(check.render).toBe('@startuml\nAlice -> Bob\n@enduml');
  });

  it('leaves !includesub and a selector to the engine, which applies them', () => {
    const check = checkSource(
      blockOf('@startuml', '!includesub x.puml!PART', '!include parts.puml!1', '!include_once parts.puml!SECOND', '@enduml'),
      LABELS
    );
    expect(check.problems).toEqual([]);
  });
});

describe('renderProblems', () => {
  const at = (...source: string[]) => {
    const block = blockOf(...source);
    return { block, check: checkSource(block, LABELS) };
  };

  it('puts a syntax error on the document line the engine names', () => {
    // syntax-error.svg blames line 3 of "@startuml / Alice -> Bob / this is not valid ;;; [[[ / @enduml".
    const { block, check } = at('@startuml', 'Alice -> Bob', 'this is not valid ;;; [[[', '@enduml');
    expect(renderProblems(block, check, { svg: engineOutput('syntax-error') }, LABELS)).toEqual([
      {
        line: 5,
        severity: 'error',
        code: PROBLEM_CODES.SYN001,
        message: 'Syntax Error? (Assumed diagram type: sequence)',
      },
    ]);
  });

  it('names why a local include failed, when the host knows', () => {
    const { block, check } = at('@startuml', '!include shared.puml', 'Alice -> Bob', '@enduml');
    const failedIncludes = new Map([['shared.puml', 'not found next to the including file']]);
    expect(renderProblems(block, check, { svg: engineOutput('include-failure'), failedIncludes }, LABELS)).toEqual([
      {
        line: 4,
        severity: 'error',
        code: PROBLEM_CODES.INC001,
        message: 'cannot include shared.puml: not found next to the including file',
      },
    ]);
  });

  it('explains an include, an import or a theme the engine cannot read', () => {
    const { block, check } = at('@startuml', '!include shared.puml', 'Alice -> Bob', '@enduml');
    expect(renderProblems(block, check, { svg: engineOutput('include-failure') }, LABELS)).toEqual([
      { line: 4, severity: 'error', code: PROBLEM_CODES.CAP001, message: 'cannot include shared.puml: no files' },
    ]);
    expect(renderProblems(block, check, { svg: errorImage(2, 'Cannot import') }, LABELS)[0]?.code).toBe(
      PROBLEM_CODES.CAP001
    );
    expect(renderProblems(block, check, { svg: errorImage(2, 'Cannot load theme foo in ./themes') }, LABELS)[0]).toEqual({
      line: 4,
      severity: 'error',
      code: PROBLEM_CODES.CAP001,
      message: 'Cannot load theme foo in ./themes: bundled themes only',
    });
  });

  it('leaves a diagram or a sub the delivered file does not have to the engine’s words', () => {
    const { block, check } = at('@startuml', '!include parts.puml!THIRD', '!includesub parts.puml!OTHER', '@enduml');
    for (const [line, message] of [
      [2, 'cannot include parts.puml!THIRD'],
      [3, 'cannot include parts.puml!OTHER'],
    ] as const) {
      expect(renderProblems(block, check, { svg: errorImage(line, message), failedIncludes: new Map() }, LABELS)[0]).toEqual({
        line: line + 2,
        severity: 'error',
        code: PROBLEM_CODES.SYN001,
        message,
      });
    }
  });

  it('says why a theme from a folder was not read, when the loader was asked for it', () => {
    const { block, check } = at('@startuml', '!theme foo from themes', 'Alice -> Bob', '@enduml');
    const failedIncludes = new Map([['themes/puml-theme-foo.puml', 'missing']]);
    expect(
      renderProblems(block, check, { svg: errorImage(2, 'Cannot load theme foo in themes'), failedIncludes }, LABELS)[0]
    ).toEqual({
      line: 4,
      severity: 'error',
      code: PROBLEM_CODES.INC001,
      message: 'Cannot load theme foo in themes: missing',
    });
  });

  it('names the library behind the engine’s "Fatal parsing error"', () => {
    const { block, check } = at('@startuml', '!include <C4/C4_Context>', '@enduml');
    expect(renderProblems(block, check, { svg: errorImage(2, 'Fatal parsing error') }, LABELS)).toEqual([
      { line: 4, severity: 'error', code: PROBLEM_CODES.CAP001, message: 'C4 not bundled' },
    ]);
    // Elsewhere it stays the engine's own error.
    const plain = at('@startuml', 'Alice -> Bob', '@enduml');
    expect(renderProblems(plain.block, plain.check, { svg: errorImage(2, 'Fatal parsing error') }, LABELS)[0]?.code).toBe(
      PROBLEM_CODES.SYN001
    );
  });

  it('puts an error on a line the extension added on the diagram’s start line', () => {
    // The source has 2 lines; the engine was given a third, the added @enduml.
    const { block, check } = at('@startuml', 'Alice -> Bob');
    expect(renderProblems(block, check, { svg: errorImage(3, 'Syntax Error?') }, LABELS)[0]?.line).toBe(3);
  });

  it('turns the engine’s exceptions into problems on the start line', () => {
    const { block, check } = at('@startuml', 'Alice -> Bob : <:smile:>', '@enduml');
    const problem = (error: string) => renderProblems(block, check, { error }, LABELS)[0];
    expect(problem('java.lang.RuntimeException: Failed to load emoji.js')).toEqual({
      line: 3,
      severity: 'error',
      code: PROBLEM_CODES.CAP001,
      message: 'emoji',
    });
    expect(
      problem(
        'java.lang.RuntimeException: Diagram too large for browser rendering: 155x10886 (max 8192; override via the maxSvgSize option, or set it to 0 to disable this check)'
      )
    ).toMatchObject({ code: PROBLEM_CODES.LIM001, message: 'too large (155x10886, max 8192)' });
    expect(problem('Rendering timed out')).toMatchObject({ code: PROBLEM_CODES.RUN001 });
    expect(problem('Worker exited')).toMatchObject({ code: PROBLEM_CODES.RUN002, message: 'Worker exited' });
  });

  it('reports the engine’s warnings on the start line, and nothing for a clean diagram', () => {
    const { block, check } = at('@startuml', 'start', '#pink:deprecated colour', 'second line;', 'stop', '@enduml');
    const found = renderProblems(block, check, { svg: engineOutput('warning') }, LABELS);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ line: 3, severity: 'warning', code: PROBLEM_CODES.WRN001 });
    expect(found[0]?.message).toContain('deprecated');
    expect(renderProblems(block, check, { svg: engineOutput('sequence') }, LABELS)).toEqual([]);
  });
});
