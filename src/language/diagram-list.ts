/**
 * The diagrams of a Markdown document as Go to Diagram in Document lists
 * them: each block, named or not, drawn or not, with what tells it apart —
 * its name, the kind its start line declares, the heading above it, its
 * title, and a first line of its source. Nothing is drawn for the list.
 *
 * Like the completion, this has no dependency on the `vscode` module.
 * Lines are counted from 0.
 */

import { splitLines } from '../core/lines';
import { forEachCodeLine, START } from '../core/shape';
import { findPlantUmlBlocks, proseLinesOf } from '../export/blocks';

/** One block of a document, as the list shows it. */
export interface DiagramEntry {
  /** The block's name, or null. */
  name: string | null;
  /** The line the block's fence is on. */
  line: number;
  /**
   * The kind the start line declares — `mindmap` for `@startmindmap` — or
   * null for `@startuml`, which declares none, and for a block without a
   * start line.
   */
  kind: string | null;
  /** The text of the last heading above the block, or null. */
  heading: string | null;
  /** The diagram's `title`, or null. */
  title: string | null;
  /** The first line of the diagram's source after its start line, or null for none. */
  summary: string | null;
}

/** An ATX heading: its text, without the marks. */
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
/** A diagram's `title` line: its text. */
const TITLE = /^\s*title\s+(.+?)\s*$/i;
/** How much of a line the summary keeps. */
const SUMMARY_LENGTH = 60;

/** The last heading above `line` that is Markdown text, not a line of a code block. */
function headingAbove(lines: readonly string[], prose: (line: number) => boolean, line: number): string | null {
  for (let at = line - 1; at >= 0; at -= 1) {
    const match = HEADING.exec(lines[at] ?? '');
    if (match !== null && prose(at)) {
      return match[1] ?? '';
    }
  }
  return null;
}

/** The kind the start line of `source` declares, if any (see {@link DiagramEntry.kind}). */
function declaredKind(source: string): string | null {
  let kind: string | null = null;
  forEachCodeLine(source, (line) => {
    const match = START.exec(line);
    if (kind === null && match !== null) {
      kind = (match[2] ?? '').toLowerCase();
    }
  });
  return kind === 'uml' ? null : kind;
}

/** The title and the first source line of a diagram, after its start line. */
function titleAndSummary(source: string): { title: string | null; summary: string | null } {
  let title: string | null = null;
  let summary: string | null = null;
  let started = false;
  forEachCodeLine(source, (line) => {
    if (!started && START.test(line)) {
      started = true;
      return;
    }
    const trimmed = line.trim();
    if (trimmed === '' || /^[@\\]end/.test(trimmed)) {
      return;
    }
    const titled = TITLE.exec(line);
    if (titled !== null && title === null) {
      title = titled[1] ?? '';
    }
    if (summary === null && titled === null) {
      summary = trimmed.length > SUMMARY_LENGTH ? `${trimmed.slice(0, SUMMARY_LENGTH - 1)}…` : trimmed;
    }
  });
  return { title, summary };
}

/** The diagram blocks of a Markdown `text`, in source order. */
export function listDiagrams(text: string): DiagramEntry[] {
  const lines = splitLines(text);
  const prose = proseLinesOf(text);
  return findPlantUmlBlocks(text).map((block) => ({
    name: block.name,
    line: block.openLine,
    kind: declaredKind(block.source),
    heading: headingAbove(lines, prose, block.openLine),
    ...titleAndSummary(block.source),
  }));
}
