/**
 * The lenses above each diagram — Preview, Export SVG, Export PNG — and the
 * target a lens hands its command: what the lens named, and how that is
 * found again when the command runs.
 */

import { diagramShape, hasStartLine } from '../core/shape';
import type { PlantUmlBlock } from '../export/blocks';

/** What a lens does with its diagram: shows it, or writes it as SVG or PNG. */
export type DiagramAction = 'preview' | 'svg' | 'png';

/** Every action, in the order the lenses show them. */
export const DIAGRAM_ACTIONS: readonly DiagramAction[] = ['preview', 'svg', 'png'];

/**
 * A diagram as a lens names it, with the action: the document's URI and its
 * version when the lens was made, the line the diagram started on then (its
 * fence or `@start…` line) and its name then. The command checks these
 * against the document as it is when it runs ({@link targetBlock}), so a
 * lens left from before an edit does not act on whatever diagram moved onto
 * its line.
 */
export interface DiagramTarget {
  action: DiagramAction;
  uri: string;
  version: number;
  line: number;
  name: string | null;
}

/** A diagram that gets lenses, and the actions they offer. */
export interface DiagramLens {
  block: PlantUmlBlock;
  actions: readonly DiagramAction[];
}

/**
 * The lenses of a document's blocks, `plantUml` for a PlantUML file. A
 * PlantUML file with no start line holds lines to include rather than a
 * diagram, so it gets none; a Markdown block that holds several diagrams is
 * not exported as one, so it gets the preview only.
 */
export function diagramLenses(blocks: readonly PlantUmlBlock[], plantUml: boolean): DiagramLens[] {
  if (plantUml) {
    return blocks.filter((block) => hasStartLine(block.source)).map((block) => ({ block, actions: DIAGRAM_ACTIONS }));
  }
  return blocks.map((block) => ({
    block,
    actions: diagramShape(block.source).kind === 'several' ? ['preview'] : DIAGRAM_ACTIONS,
  }));
}

/** Whether `value` counts something: a version or a line. */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** The {@link DiagramTarget} the command was given, checked; null for anything else. */
export function diagramTarget(value: unknown): DiagramTarget | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { action, uri, version, line, name } = value as Record<string, unknown>;
  return (DIAGRAM_ACTIONS as readonly unknown[]).includes(action) &&
    typeof uri === 'string' &&
    isCount(version) &&
    isCount(line) &&
    (name === null || typeof name === 'string')
    ? { action: action as DiagramAction, uri, version, line, name }
    : null;
}

/**
 * The block `target` names among `blocks`, the document's blocks now that it
 * is at `version`: the block on the line while the document is as it was
 * when the lens was made, and once it changed, the one block of that name,
 * as the lines may have moved. Null when there is no such block, or several:
 * an unnamed diagram is known by its line only while that line holds.
 */
export function targetBlock(blocks: readonly PlantUmlBlock[], target: DiagramTarget, version: number): PlantUmlBlock | null {
  if (version === target.version) {
    return blocks.find((block) => block.openLine === target.line) ?? null;
  }
  if (target.name === null) {
    return null;
  }
  const named = blocks.filter((block) => block.name === target.name);
  return named.length === 1 ? (named[0] ?? null) : null;
}
