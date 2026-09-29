/**
 * The PlantUML grammar: one block per `@start…` … `@end…` pair.
 *
 * The engine picks the diagram type from the name after `@start` (a
 * case-insensitive prefix match, so `@startumlx` is a UML diagram) and
 * ends the block at the first line starting with `@end` or `\end`. Each
 * supported type gets its own body; the types the browser engine does not
 * render get only comments and the preprocessor, and their name is marked
 * invalid, since the preview shows an error for them.
 */

import { preprocessorRepository } from './preprocessor';
import { BOL, include, merge, named, re, scope, type Grammar, type Rule } from './rules';

export const PLANTUML_SCOPE = 'source.plantuml-local';

interface DiagramKind {
  /** Names after `@start` that select this kind, as the engine spells them. */
  names: readonly string[];
  /** Repository entry holding the body rules. */
  body: string;
}

/** The `@start…` names the bundled engine renders. */
export const SUPPORTED_DIAGRAMS: readonly DiagramKind[] = [
  { names: ['uml'], body: 'uml-body' },
  { names: ['gantt', 'project'], body: 'gantt-body' },
  { names: ['mindmap'], body: 'mindmap-body' },
  { names: ['wbs'], body: 'wbs-body' },
  { names: ['nwdiag'], body: 'nwdiag-body' },
  { names: ['creole'], body: 'creole-body' },
  { names: ['chart'], body: 'chart-body' },
  { names: ['packetdiag'], body: 'packetdiag-body' },
  { names: ['json'], body: 'json-body' },
  { names: ['yaml'], body: 'yaml-body' },
  { names: ['ebnf'], body: 'ebnf-body' },
  { names: ['regex'], body: 'regex-body' },
];

const diagramEnd = {
  end: re`${BOL}\s*([@\\]end)(\S*)(.*)$`,
  endCaptures: { 1: named('keyword.control.diagram'), 2: named('keyword.control.diagram') },
};

function diagram(kind: DiagramKind): Rule {
  return {
    name: scope(`meta.diagram.${kind.names[0]}`),
    begin: re`${BOL}\s*([@\\]start)((?i:${kind.names.join('|')}))(.*)$`,
    beginCaptures: {
      1: named('keyword.control.diagram'),
      2: named('keyword.control.diagram'),
      3: named('entity.name.section.diagram'),
    },
    ...diagramEnd,
    patterns: [include(kind.body)],
  };
}

/** Everything else after `@start`: the engine reports it as unsupported. */
const unsupportedDiagram: Rule = {
  name: scope('meta.diagram.unsupported'),
  begin: re`${BOL}\s*([@\\]start)(\S+)(.*)$`,
  beginCaptures: {
    1: named('keyword.control.diagram'),
    2: named('invalid.illegal.unsupported-diagram'),
    3: named('entity.name.section.diagram'),
  },
  ...diagramEnd,
  patterns: [include('comment'), include('preprocessor')],
};

/**
 * Wraps the line rules of a body so that a block comment opening a line
 * (`/' note '/ A -> B`) hands the rest of the line to them.
 */
export function afterLeadingComment(body: string): Rule {
  return {
    begin: re`${BOL}\s*(/')(.*?)('/)`,
    beginCaptures: {
      0: named('comment.block'),
      1: named('punctuation.definition.comment'),
      3: named('punctuation.definition.comment'),
    },
    end: re`$`,
    patterns: [include(body)],
  };
}

export function plantumlGrammar(repository: Record<string, Rule>): Grammar {
  return {
    scopeName: PLANTUML_SCOPE,
    name: 'PlantUML (PlantUML Local)',
    patterns: [...SUPPORTED_DIAGRAMS.map(diagram), unsupportedDiagram],
    repository: merge(
      preprocessorRepository,
      {
        /** Text-level rules shared by every label, name and free-text line. */
        inline: {
          patterns: [include('comment-inline'), include('inline-preprocessor'), include('creole-inline')],
        },
      },
      repository
    ),
  };
}
