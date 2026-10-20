import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { checkSource, PROBLEM_CODES, renderProblems, type ProblemLabels } from '../../src/diagnostics/problems';
import { findPlantUmlBlocks, type PlantUmlBlock } from '../../src/export/blocks';

const LABELS: ProblemLabels = {
  errorMessage: (message) => message,
  remoteReference: 'remote',
  severalDiagrams: 'several',
  pages: 'pages',
  missingEnd: (end) => `no ${end}`,
  beforeStart: (start) => `above ${start}`,
  themeFrom: 'bundled themes only',
  libraryNotBundled: (library) => `${library} not bundled`,
  emojiUnavailable: 'emoji',
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

  it('warns about what is drawn anyway: lines above the start line, on the first of them', () => {
    const block = blockOf("' a comment", 'title Before', 'skinparam monochrome true', '@startuml', 'Alice -> Bob', '@enduml');
    const check = checkSource(block, LABELS);
    expect(check.problems).toEqual([
      { line: 4, severity: 'warning', code: PROBLEM_CODES.DOC004, message: 'above @startuml' },
    ]);
    expect(check.render).toBe(block.source);
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
    // errorMessage says what to use instead (see localization.test.ts).
    expect(renderProblems(block, check, { svg: engineOutput('include-failure') }, LABELS)).toEqual([
      { line: 4, severity: 'error', code: PROBLEM_CODES.CAP001, message: 'cannot include shared.puml' },
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
      // The file the loader was asked for, as the preview's note names it.
      message: 'cannot include themes/puml-theme-foo.puml: missing',
    });
  });

  it('names a standard library that is not bundled', () => {
    const { block, check } = at('@startuml', '!include <C4/C4_Context>', '@enduml');
    expect(renderProblems(block, check, { svg: errorImage(2, 'cannot include &lt;C4/C4_Context&gt;') }, LABELS)).toEqual([
      { line: 4, severity: 'error', code: PROBLEM_CODES.CAP001, message: 'C4 not bundled' },
    ]);
    // Azure is bundled: an entry it does not have is the engine's own error.
    const azure = at('@startuml', '!include <azure/NoSuchThing>', '@enduml');
    expect(
      renderProblems(azure.block, azure.check, { svg: errorImage(2, 'cannot include &lt;azure/NoSuchThing&gt;') }, LABELS)
    ).toEqual([
      { line: 4, severity: 'error', code: PROBLEM_CODES.SYN001, message: 'cannot include <azure/NoSuchThing>' },
    ]);
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
    ).toMatchObject({ code: PROBLEM_CODES.LIM001, message: expect.stringContaining('155x10886') });
    expect(problem('Rendering timed out')).toMatchObject({ code: PROBLEM_CODES.RUN001 });
    expect(problem('Worker exited')).toMatchObject({ code: PROBLEM_CODES.RUN002, message: 'Worker exited' });
  });

  it('reports the report of a Graphviz crash as a failure of the engine, on the start line', () => {
    // The engine draws it through the success path, like a syntax error, but
    // nothing in the source is wrong as written: Graphviz failed to lay it out.
    const { block, check } = at('@startuml', 'package p0 {', 'class Leaf', '}', '@enduml');
    expect(renderProblems(block, check, { svg: engineOutput('graphviz-crash') }, LABELS)).toEqual([
      {
        line: 3,
        severity: 'error',
        code: PROBLEM_CODES.RUN002,
        message: 'For some reason, dot/GraphViz has crashed.',
      },
    ]);
  });

  it('reports the engine’s warnings on the start line, and nothing for a clean diagram', () => {
    const { block, check } = at('@startuml', 'start', '#pink:deprecated colour', 'second line;', 'stop', '@enduml');
    const found = renderProblems(block, check, { svg: engineOutput('warning') }, LABELS);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ line: 3, severity: 'warning', code: PROBLEM_CODES.WRN001 });
    expect(found[0]?.message).toContain('deprecated');
    expect(renderProblems(block, check, { svg: engineOutput('sequence') }, LABELS)).toEqual([]);
  });

  it('localises timeout details without changing the diagnostic code', () => {
    const { block, check } = at('@startuml', 'A -> B', '@enduml');
    const labels = { ...LABELS, errorMessage: () => '描画が制限時間内に完了しませんでした。' };
    expect(renderProblems(block, check, { error: 'Rendering timed out' }, labels)[0]).toMatchObject({
      code: PROBLEM_CODES.RUN001,
      message: '描画が制限時間内に完了しませんでした。',
    });
  });

  it('localises a warning while preserving its severity and code', () => {
    const { block, check } = at('@startuml', 'start', '#pink:label;', 'stop', '@enduml');
    const labels = { ...LABELS, errorMessage: () => '行末に <<#pink>> を追加してください。' };
    expect(renderProblems(block, check, { svg: engineOutput('warning') }, labels)[0]).toMatchObject({
      code: PROBLEM_CODES.WRN001,
      severity: 'warning',
      message: '行末に <<#pink>> を追加してください。',
    });
  });
});
