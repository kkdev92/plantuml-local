/**
 * The problems a diagram block raises, for the Problems panel.
 *
 * The bundled engine returns nothing structured. An error comes back as a
 * drawing that names the line (src/render/engine-error.ts), a warning as a
 * banner drawn above the diagram that names no line, and a few failures as
 * exceptions; the engine stops at the first error, so a block yields at most
 * one. What the engine drops or ignores without a word is found in the
 * source instead (src/core/shape.ts).
 *
 * Lines are document lines, counting from 0. A problem the engine places
 * nowhere (a warning, an exception, an error inside an included library, or
 * on a line the extension added) goes on the diagram's start line.
 *
 * This module has no dependency on the `vscode` module, so it is
 * unit-testable.
 */

import { EMOJI_UNAVAILABLE, remoteReferenceLine } from '../core/constants';
import { diagramShape } from '../core/shape';
import type { PlantUmlBlock } from '../export/blocks';
import { withIncludeReason } from '../includes/describe';
import { recognizeEngineError, recognizeEngineWarnings } from '../render/engine-error';

/**
 * The code each kind of problem carries in the Problems panel. They stay the
 * same from release to release, so a problem can be looked up or filtered.
 */
export const PROBLEM_CODES = {
  /** The start and end lines of a diagram do not match. */
  DOC002: 'PLLOCAL-DOC002',
  /** More than one diagram in a block. */
  DOC003: 'PLLOCAL-DOC003',
  /** A syntax error the engine reported. */
  SYN001: 'PLLOCAL-SYN001',
  /** Something this extension does not support, including what the engine drops silently. */
  CAP001: 'PLLOCAL-CAP001',
  /** A local include that failed, with why. */
  INC001: 'PLLOCAL-INC001',
  /** A diagram larger than the engine draws. */
  LIM001: 'PLLOCAL-LIM001',
  /** A render that took too long. */
  RUN001: 'PLLOCAL-RUN001',
  /** Any other failure of the engine or its worker. */
  RUN002: 'PLLOCAL-RUN002',
  /** A warning the engine drew above the diagram. */
  WRN001: 'PLLOCAL-WRN001',
} as const;

export interface BlockProblem {
  /** Document line, counting from 0. */
  line: number;
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

/** User-visible explanations, localised by the caller (vscode.l10n). */
export interface ProblemLabels {
  remoteReference: string;
  severalDiagrams: string;
  pages: string;
  missingEnd(end: string): string;
  /** Follows the engine's "cannot include …" or "Cannot import". */
  localFile: string;
  /** Follows the engine's "Cannot load theme … in …" for a theme no file was asked for: from a library or a URL. */
  themeFrom: string;
  libraryNotBundled(library: string): string;
  emojiUnavailable: string;
  tooLarge: string;
}

/** What a block's source says before it is rendered. */
export interface SourceCheck {
  problems: BlockProblem[];
  /** The source to hand the engine, or null when it is not rendered. */
  render: string | null;
  /** Where problems the engine places nowhere go: the diagram's start line. */
  startLine: number;
}

/**
 * What rendering produced: the engine's SVG, with why each failed local
 * include failed, or the error it threw.
 */
export type RenderOutcome = { svg: string; failedIncludes?: ReadonlyMap<string, string> } | { error: string };

export function checkSource(block: PlantUmlBlock, labels: ProblemLabels): SourceCheck {
  const at = (index: number): number => block.sourceLine + index;
  const problems: BlockProblem[] = [];
  if (block.source === '') {
    return { problems, render: null, startLine: block.openLine };
  }

  const shape = diagramShape(block.source);
  const startLine = shape.kind === 'drawable' && shape.startLine !== null ? at(shape.startLine) : block.sourceLine;
  const problem = (line: number, severity: BlockProblem['severity'], code: string, message: string): void => {
    problems.push({ line, severity, code, message });
  };

  // The preview refuses these without rendering, so they are all there is.
  const remote = remoteReferenceLine(block.source);
  if (remote !== null) {
    problem(at(remote), 'error', PROBLEM_CODES.CAP001, labels.remoteReference);
    return { problems, render: null, startLine };
  }
  if (shape.kind === 'several') {
    problem(at(shape.line), 'error', PROBLEM_CODES.DOC003, labels.severalDiagrams);
    return { problems, render: null, startLine };
  }
  if (shape.kind === 'pages') {
    problem(at(shape.line), 'error', PROBLEM_CODES.CAP001, labels.pages);
    return { problems, render: null, startLine };
  }

  if (shape.addedEnd !== null) {
    problem(startLine, 'warning', PROBLEM_CODES.DOC002, labels.missingEnd(shape.addedEnd));
  }
  return { problems, render: shape.source, startLine };
}

export function renderProblems(
  block: PlantUmlBlock,
  check: SourceCheck,
  outcome: RenderOutcome,
  labels: ProblemLabels
): BlockProblem[] {
  const atStart = (code: string, message: string): BlockProblem[] => [
    { line: check.startLine, severity: 'error', code, message },
  ];

  if ('error' in outcome) {
    const message = outcome.error;
    if (EMOJI_UNAVAILABLE.test(message)) {
      return atStart(PROBLEM_CODES.CAP001, labels.emojiUnavailable);
    }
    if (/Diagram too large for browser rendering/.test(message)) {
      // The engine's own wording goes on about an option of its API that
      // nobody using the extension can set; the size is what matters.
      const size = /(\d+x\d+) \(max (\d+)/.exec(message);
      return atStart(
        PROBLEM_CODES.LIM001,
        size === null ? labels.tooLarge : `${labels.tooLarge} (${size[1] ?? ''}, max ${size[2] ?? ''})`
      );
    }
    if (message === 'Rendering timed out') {
      return atStart(PROBLEM_CODES.RUN001, message);
    }
    return atStart(PROBLEM_CODES.RUN002, message);
  }

  const failure = recognizeEngineError(outcome.svg);
  if (failure === null) {
    return recognizeEngineWarnings(outcome.svg).map((message) => ({
      line: check.startLine,
      severity: 'warning',
      code: PROBLEM_CODES.WRN001,
      message,
    }));
  }

  // The engine counts the lines it was given; past the block's own lines are
  // the ones added for it, which are nowhere in the document.
  const lines = block.source.split(/\r?\n/);
  const located = failure.line !== null && failure.line <= lines.length ? failure.line : null;
  const line = located === null ? check.startLine : block.sourceLine + located - 1;
  const text = located === null ? '' : (lines[located - 1] ?? '');
  const { code, message } = classify(failure.message, text, labels, outcome.failedIncludes);
  return [{ line, severity: 'error', code, message }];
}

/** Tells an unsupported feature from a syntax error, by the engine's message. */
function classify(
  message: string,
  line: string,
  labels: ProblemLabels,
  failedIncludes: ReadonlyMap<string, string> = new Map()
): { code: string; message: string } {
  if (/^cannot include /.test(message) || message === 'Cannot import') {
    const explained = withIncludeReason(message, failedIncludes);
    if (explained !== message) {
      return { code: PROBLEM_CODES.INC001, message: explained };
    }
    // Unless the file was refused, a name after its `!` is a diagram or a
    // sub the file does not have: the engine's own error.
    if (!/^cannot include [^!]*!/.test(message)) {
      return { code: PROBLEM_CODES.CAP001, message: `${message}: ${labels.localFile}` };
    }
  }
  if (/^Cannot load theme \S+ in /.test(message)) {
    // A theme from a folder is asked of the loader, which says why it failed.
    const explained = withIncludeReason(message, failedIncludes);
    return explained !== message
      ? { code: PROBLEM_CODES.INC001, message: explained }
      : { code: PROBLEM_CODES.CAP001, message: `${message}: ${labels.themeFrom}` };
  }
  // The engine's only words for a library that is not bundled.
  const library = /^\s*!include(?:_once|_many)?\s*<([^/>]+)/.exec(line)?.[1];
  if (message === 'Fatal parsing error' && library !== undefined && library.toLowerCase() !== 'azure') {
    return { code: PROBLEM_CODES.CAP001, message: labels.libraryNotBundled(library) };
  }
  return { code: PROBLEM_CODES.SYN001, message };
}
