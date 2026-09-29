/**
 * JSON (@startjson) and YAML (@startyaml) diagrams.
 *
 * The data itself is highlighted by VS Code's own JSON and YAML grammars.
 * Around it the engine takes (StyleExtractor, JsonDiagramFactory,
 * YamlDiagramFactory, all case-sensitive):
 *  - anywhere: <style> … </style> blocks and `#highlight path / path` lines;
 *    in JSON any other line starting with `#` is dropped;
 *  - before the first data line only: title, scale, skin, skinparam (one
 *    line or a { } block), hide, !pragma and !assume;
 *  - on every line, before all of that: the preprocessor.
 *
 * Once the data starts, the embedded grammar owns the lines, so the rules
 * that still apply inside it come from injection grammars (VS Code only
 * honours injections from injection grammars and from the root grammar,
 * which inside Markdown is Markdown's).
 */

import { PLANTUML_SCOPE } from './plantuml';
import { BOL, EOL, SP, include, named, nested, re, scope, type Grammar, type Rule } from './rules';

export const DATA_INJECTION_SCOPE = 'plantuml-local.data-injection';
export const JSON_INJECTION_SCOPE = 'plantuml-local.json-injection';

const kw = named('keyword.other');

function dataBody(kind: 'json' | 'yaml', embedded: string): Rule {
  return {
    patterns: [
      include('preprocessor'),
      include('style'),
      include('data-highlight'),
      ...(kind === 'json' ? [include('data-hash-line')] : []),
      include('data-header'),
      {
        begin: re`${BOL}(?=\s*\S)`,
        while: re`${BOL}(?!\s*[@\\]end)`,
        contentName: `meta.embedded.block.${kind} ${scope('meta.data')} ${scope(`meta.data.${kind}`)}`,
        patterns: [{ include: embedded }],
      },
    ],
  };
}

export const dataRepository: Record<string, Rule> = {
  'diagram-json': dataBody('json', 'source.json'),
  'diagram-yaml': dataBody('yaml', 'source.yaml'),

  /** #highlight "a" / "b" / * <<stereotype>> */
  'data-highlight': {
    match: re`${BOL}(#highlight)${SP}+([^<>]+?)${SP}*(<<.*>>)?${SP}*$`,
    captures: {
      1: kw,
      2: {
        patterns: [
          { name: scope('keyword.operator.path'), match: re`/` },
          { name: scope('keyword.operator.wildcard'), match: re`\*\*?` },
          include('string'),
          { name: scope('string.unquoted.key'), match: re`[^/\s"*]+` },
        ],
      },
      3: nested('#stereotype'),
    },
  },

  /** In a JSON diagram the engine drops any other line that starts with `#`. */
  'data-hash-line': { name: scope('comment.line.number-sign'), match: re`${BOL}#(?!highlight${SP}).*$` },

  /** Commands the engine accepts before the data starts. */
  'data-header': {
    patterns: [
      {
        match: re`${BOL}\s*(title)${SP}+(.*?)${EOL}`,
        captures: { 1: kw, 2: nested('#label') },
      },
      include('scale'),
      {
        match: re`${BOL}\s*(skin)${SP}+(.*?)${SP}*$`,
        captures: { 1: kw, 2: named('support.constant.skin') },
      },
      include('skinparam'),
      {
        match: re`${BOL}\s*(hide)${SP}+(.*?)${SP}*$`,
        captures: { 1: kw, 2: nested('#hide-show-target') },
      },
      {
        match: re`${BOL}\s*(!pragma|!assume)${SP}+(.*?)${SP}*$`,
        captures: { 1: named('keyword.control.directive'), 2: nested('#skinparam-value') },
      },
    ],
  },
};

/**
 * What keeps applying inside JSON and YAML data: comments, preprocessor
 * lines and substitutions, style blocks, highlight lines.
 */
export const dataInjectionGrammar: Grammar = {
  scopeName: DATA_INJECTION_SCOPE,
  injectionSelector: 'L:meta.data.plantuml',
  patterns: [
    { include: `${PLANTUML_SCOPE}#comment` },
    { include: `${PLANTUML_SCOPE}#preprocessor` },
    { include: `${PLANTUML_SCOPE}#style` },
    { include: `${PLANTUML_SCOPE}#data-highlight` },
    { include: `${PLANTUML_SCOPE}#inline-preprocessor` },
  ],
  repository: {},
};

/** In JSON data a line starting with `#` is dropped by the engine. */
export const jsonInjectionGrammar: Grammar = {
  scopeName: JSON_INJECTION_SCOPE,
  injectionSelector: 'L:meta.data.json.plantuml',
  patterns: [{ include: `${PLANTUML_SCOPE}#data-hash-line` }],
  repository: {},
};
