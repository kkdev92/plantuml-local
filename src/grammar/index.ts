/**
 * The grammars this extension contributes. scripts/build.mjs writes each
 * entry to dist/syntaxes/<file>, the paths package.json points at.
 */

import { activityRepository } from './activity';
import { chartRepository } from './chart';
import { classRepository } from './classes';
import { commonRepository } from './common';
import { creoleRepository } from './creole';
import { dataInjectionGrammar, dataRepository, jsonInjectionGrammar } from './data';
import { descriptionRepository } from './description';
import { ganttRepository } from './gantt';
import { markdownFallbackGrammar, markdownInjectionGrammar } from './markdown';
import { mindmapRepository } from './mindmap';
import { networkRepository } from './network';
import { notesRepository } from './notes';
import { afterLeadingComment, plantumlGrammar } from './plantuml';
import { asciiWhitespace, include, merge, type Grammar, type Rule } from './rules';
import { sequenceRepository } from './sequence';
import { stateRepository } from './state';
import { syntaxDiagramRepository } from './syntaxdiagrams';
import { timingRepository } from './timing';
import { versionRepository } from './version';

export { DATA_INJECTION_SCOPE, JSON_INJECTION_SCOPE } from './data';
export { EMBEDDED_SCOPE, MARKDOWN_FALLBACK_SCOPE, MARKDOWN_INJECTION_SCOPE } from './markdown';
export { PLANTUML_SCOPE, SUPPORTED_DIAGRAMS } from './plantuml';
export { BUILTINS } from './preprocessor';
export type { Grammar, Rule } from './rules';

/**
 * A diagram body: whole-line comments first, then the line rules — also
 * after a block comment that opens the line — then what is left of a line
 * (a closing block comment, substitutions).
 */
function body(lines: string): Rule {
  return {
    patterns: [include('comment'), afterLeadingComment(lines), include(lines), include('inline')],
  };
}

/**
 * Inside @startuml the engine tries each UML diagram type in turn and keeps
 * the first that accepts every line, so a line can belong to any of them.
 * Where two types read the same line differently, the more specific rule
 * comes first (`entity Foo {` opens a class body before it can be a
 * sequence participant; `partition Foo {` is an activity partition before
 * it can be a sequence group; `WB@0 <-> @50` is a timing constraint before
 * it can be a class link). A timing player declaration switches the rest of
 * the diagram to the timing rules alone (see `timing-context`).
 */
const umlLine: Rule = {
  patterns: [
    include('preprocessor'),
    // `{{` alone on a line of the diagram itself: inside a procedure body,
    // which is expanded where the procedure is called.
    include('embedded-diagram'),
    include('timing-context'),
    include('common-commands'),
    include('note'),
    include('timing-first'),
    // `package foo [` and `card G [{{`: no class command reads a `[` there,
    // so the engine's class diagram gives these lines up to the description
    // diagram, whose multi-line form must come before the class containers.
    include('description-multiline'),
    include('class'),
    include('description'),
    include('sequence-exo-arrow'),
    include('activity'),
    include('state'),
    include('timing'),
    include('sequence'),
    include('version'),
  ],
};

/**
 * The non-UML diagram kinds. Each has a body `<kind>-body` (wired here) and
 * its line rules under `diagram-<kind>`.
 */
const OTHER_KINDS = [
  'gantt',
  'mindmap',
  'wbs',
  'nwdiag',
  'creole',
  'chart',
  'packetdiag',
  'json',
  'yaml',
  'ebnf',
  'regex',
] as const;

export const grammars: readonly { file: string; grammar: Grammar }[] = [
  {
    file: 'plantuml.tmLanguage.json',
    grammar: plantumlGrammar(
      merge(
        commonRepository,
        creoleRepository,
        notesRepository,
        sequenceRepository,
        classRepository,
        descriptionRepository,
        activityRepository,
        stateRepository,
        timingRepository,
        ganttRepository,
        chartRepository,
        mindmapRepository,
        networkRepository,
        syntaxDiagramRepository,
        dataRepository,
        versionRepository,
        { 'uml-body': body('diagram-uml'), 'diagram-uml': umlLine },
        Object.fromEntries(OTHER_KINDS.map((kind) => [`${kind}-body`, body(`diagram-${kind}`)]))
      )
    ),
  },
  { file: 'markdown-plantuml.tmLanguage.json', grammar: markdownInjectionGrammar },
  { file: 'markdown-plantuml-fallback.tmLanguage.json', grammar: markdownFallbackGrammar },
  { file: 'plantuml-data.tmLanguage.json', grammar: dataInjectionGrammar },
  { file: 'plantuml-json.tmLanguage.json', grammar: jsonInjectionGrammar },
].map(({ file, grammar }) => ({ file, grammar: asciiWhitespace(grammar) }));
