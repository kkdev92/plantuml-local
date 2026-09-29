/**
 * Class diagrams (ClassDiagramFactory): classes and every class-like
 * declaration with their member bodies, objects, maps, JSON data, packages,
 * namespaces, links, lollipops, association diamonds, and the commands the
 * description diagrams share with them (containers with a symbol, element
 * shapes, hide/show/remove, layout direction).
 */

import { COLORS } from './common';
import { BOL, DQ, EOL, NOT_DQ, SP, endOr, include, named, nested, re, scope, type Rule } from './rules';

const kw = named('keyword.other');
const decl = named('storage.type');
const typeName = named('entity.name.type');
const blockBegin = named('punctuation.section.block.begin');
const blockEnd = named('punctuation.section.block.end');

export const QUOTED = re`${DQ}${NOT_DQ}+${DQ}`;
const NBSP = re`\x{A0}`;

/** A class code: anything but blanks, braces, quotes and angle brackets (NameAndCodeParser). */
const CLASS_CODE = re`[^\s${NBSP}{}"\x{201C}\x{201D}<>]+`;

/** Generic parameters, nested a few levels deep: <T>, <K, List<V>>. Not a stereotype. */
export const GENERIC = re`<(?![<>/])(?:[^<>]|<(?:[^<>]|<(?:[^<>]|<[^<>]*>)*>)*>)*>`;

/** `"Display" as Code`, `Code as "Display"`, `Code`, `"Code"`, then generics. */
const NAME_AND_CODE = re`(?:${QUOTED}${SP}+(?i:as)${SP}+${CLASS_CODE}|${CLASS_CODE}${SP}+(?i:as)${SP}+${QUOTED}|${CLASS_CODE}|${QUOTED})(?:${SP}*${GENERIC})?`;

const CLASS_TYPES_MULTI = re`interface|enum|annotation|abstract${SP}+class|static${SP}+class|abstract|class|entity|protocol|struct|exception|metaclass|stereotype|dataclass|record`;
const CLASS_TYPES_SINGLE = re`${CLASS_TYPES_MULTI}|circle|diamond|map`;

/**
 * Separator in class identifiers used by links (CommandLinkClass). The
 * engine accepts nearly any punctuation; brackets, parentheses, `?`, `&`,
 * `*` and `|` are left out here because a line such as `[o-> Alice` (a
 * sequence message from the edge) would otherwise read as a class link, and
 * a leading separator is only `.`, `::` or `\\` (an absolute namespace).
 */
const SEP = re`(?:[^\p{L}\p{N}\s${NBSP}_$#\\:{}<>"\x{201C}\x{201D}\[\]()?&*|]|\\\\|::)`;
const LEAD_SEP = re`(?:\.|::|\\\\)`;
const CLASS_ID = re`(?:${LEAD_SEP}?[\p{L}\p{N}_$]+(?:${SEP}[\p{L}\p{N}_$]+)*|${QUOTED})`;
const COUPLE_PART = re`(?:${LEAD_SEP}?[\p{L}\p{N}_]+(?:${SEP}[\p{L}\p{N}_]+)*|${QUOTED})`;
const COUPLE = re`\(${SP}*${COUPLE_PART}${SP}*,${SP}*${COUPLE_PART}${SP}*\)`;

/** Link decorations (LinkDecor), longest first. */
export const HEAD1 = re`(?:<\|\||<\|:|<\||\}o\b|\|o\b|\|\||\}\||<<|<_|\^|\*|\bo\b|x|\}|<|0\)|0|@|\)|#|\+)`;
export const HEAD2 = re`(?:\|\|>|:\|>|\|>|\bo\{|\bo\||\|\||\|\{|>>|_>|\^|\*|\bo\b|x|\{|>|\(0|0|@|\(|#|\+|\\\\|//)`;

// Keywords of a command match in any case, as in the engine (see sequence.ts).
const LINE_STYLE_KEY = re`(?i:dotted|dashed|plain|bold|hidden|norank|single|node|thickness=\d+)`;
export const LINE_STYLE = re`(?:#\w+|${LINE_STYLE_KEY})(?:,#\w+|,(?:${LINE_STYLE_KEY}))*`;
const STYLE = re`(?:\[${LINE_STYLE}\])?`;
export const DIRECTION = re`(?i:left|right|up|down|le?|ri?|up?|do?)`;
export const INSIDE = re`(?:(?:0|\(0\)|\(0|0\))(?=[-=.~]))`;

/** The arrow of a class link: head, body, style, direction, middle circle, body, head. */
const CLASS_ARROW = re`${HEAD1}?[-=.]+${STYLE}${DIRECTION}?${INSIDE}?${STYLE}[-=.]*${HEAD2}?`;

/** What may follow the second end of a link: colour, link, stereotype, label. */
const LINK_TAIL = re`${SP}*(?:${COLORS})?${SP}*(?:\[\[.*?\]\])?${SP}*(?:<<.+?>>)?${SP}*(?::.*)?`;

const MODIFIER = re`\{(?i:static|classifier|abstract|method|field)\}`;

/**
 * An element name: letters, digits, `_` and dots, with at least one that is
 * not a dot (`...` is a sequence delay, not a name). A `$` prefix is
 * allowed: the preprocessor substitutes such names before the engine reads
 * the line.
 */
export const EL_NAME = re`\$?[\p{L}\p{N}_.]*[\p{L}\p{N}_][\p{L}\p{N}_.]*`;

/** Element names of the description diagrams (CommandCreateElementFull). */
const EL_CODE_CORE = re`${EL_NAME}|\(\)${SP}*${EL_NAME}|\(\)${SP}*${QUOTED}|:[^:]+:/?|\([^()]+\)/?|\[[^\[\]]+\]`;
const EL_CODE = re`(?:${EL_CODE_CORE})`;
// A quoted display holds no quote: a looser pattern would read
// `"A" -down-> "B" as C` (a legacy activity link) as one display.
const EL_DISPLAY_CORE = re`${QUOTED}|:[^:]+:/?|\([^()]+\)/?|\[[^\[\]]+\]`;
const STEREO_OPT = re`${SP}*(?:<<.+?>>)?${SP}*`;
const TAG = re`\$[^\s${NBSP}{}"<>$]+`;

/** `"Display" as code`, `code as "Display"`, `Display as code`, or a code alone. */
export const ELEMENT_FORMS = re`(?:(?:${EL_DISPLAY_CORE})${STEREO_OPT}(?i:as)${SP}+${EL_CODE}|${EL_CODE}${STEREO_OPT}(?i:as)${SP}*(?:${EL_DISPLAY_CORE})|(?:${EL_DISPLAY_CORE}|[\p{L}\p{N}_.]+)${STEREO_OPT}(?i:as)${SP}+${EL_CODE}|${EL_CODE_CORE}|${QUOTED})`;

/** Tags, stereotype, link and colour after an element. */
export const ELEMENT_TAIL = re`${SP}*(?:${TAG}(?:${SP}+${TAG})*)?${STEREO_OPT}(?:${TAG}(?:${SP}+${TAG})*)?${SP}*(?:\[\[.*?\]\])?${SP}*(?:${COLORS})?`;

/** The keywords that name an element's shape (ALL_TYPES upstream). */
export const ELEMENT_TYPES = re`person|artifact|actor/|actor|folder|card|file|package|rectangle|hexagon|label|node|frame|cloud|action|process|database|queue|stack|storage|agent|usecase/|usecase|component|boundary|control|entity|interface|circle|collections|port|portin|portout`;

/**
 * A declaration line without `{`: `class Foo` alone, or followed by a line
 * holding only `{` (the engine moves that brace up). The wrapper ends at the
 * next line with content, unless that line is the brace (or a comment,
 * which the preprocessor removes before the engine looks).
 */
function nextLineBrace(afterLineStart: string, captures: Rule['beginCaptures'], body: Rule): Rule {
  return {
    // Lines that already end with a brace belong to the multi-line rules.
    // The look-ahead comes after the line-start anchor: in front of it, it
    // would scan to the end of the line from every position of every line.
    begin: re`(?i)${BOL}(?!.*\{${SP}*$)${afterLineStart}`,
    beginCaptures: captures,
    end: re`${BOL}(?=\s*\S)(?!\s*(?:\{${SP}*$|'|/'))`,
    patterns: [include('comment'), body],
  };
}

const classBodyOnNextLine: Rule = {
  begin: re`${BOL}\s*(\{)${SP}*$`,
  end: endOr(re`${BOL}\s*(\})${SP}*$`),
  beginCaptures: { 1: blockBegin },
  endCaptures: { 1: blockEnd },
  contentName: scope('meta.class.body'),
  patterns: [include('class-body')],
};

/** `"Display"` in a header: a string whose text is the name. */
const quotedName: Rule = {
  name: scope('string.quoted.double'),
  match: re`(${DQ})(${NOT_DQ}*)(${DQ})`,
  captures: {
    1: named('punctuation.definition.string.begin'),
    2: { name: scope('entity.name.type'), patterns: [include('label')] },
    3: named('punctuation.definition.string.end'),
  },
};

const lineColor: Rule = {
  // ##[dashed]blue — the border of an element
  match: re`(##)(?:(\[)((?i:dotted|dashed|bold))(\]))?(\w+)?`,
  captures: {
    1: named('keyword.operator.line-color'),
    2: named('punctuation.definition.style.begin'),
    3: named('keyword.other.line-style'),
    4: named('punctuation.definition.style.end'),
    5: named('constant.other.color'),
  },
};

const asKeyword: Rule = {
  match: re`(?i)(?<![^\s${NBSP}])(as)(?![^\s${NBSP}])`,
  captures: { 1: kw },
};

const tag: Rule = { name: scope('entity.name.tag'), match: TAG };

export const classRepository: Record<string, Rule> = {
  class: {
    patterns: [
      include('class-declaration'),
      include('class-object'),
      include('class-map'),
      include('class-json'),
      include('class-container'),
      include('class-hide'),
      include('class-link'),
      include('class-misc'),
    ],
  },

  /**
   * hide / show / remove / restore. Tried before the links, which would
   * otherwise read `hide-class <<x>>` as a link from `hide` to `class`.
   */
  'class-hide': {
    patterns: [
      {
        match: re`(?i)${BOL}\s*(hide|hide-class|show|show-class)${SP}+([^\s${NBSP}]+|<<.*>>)${SP}*$`,
        captures: { 1: kw, 2: nested('#class-hide-target') },
      },
      {
        match: re`(?i)${BOL}\s*(remove|restore)${SP}+(.+?)${EOL}`,
        captures: { 1: kw, 2: nested('#class-hide-target') },
      },
    ],
  },

  // --- class-like declarations ------------------------------------------------

  'class-declaration': {
    patterns: [
      // class Foo {} — an empty body on the same line.
      {
        match: re`(?i)${BOL}\s*([-#+~])?${SP}*(${CLASS_TYPES_SINGLE})${SP}+(${NAME_AND_CODE})(.*?)${SP}*(\{)${SP}*(\})${SP}*$`,
        captures: {
          1: named('storage.modifier.visibility'),
          2: decl,
          3: nested('#class-header'),
          4: nested('#class-header'),
          5: blockBegin,
          6: blockEnd,
        },
      },
      // class Foo … { members }
      {
        begin: re`(?i)${BOL}\s*([-#+~])?${SP}*(${CLASS_TYPES_MULTI})${SP}+(${NAME_AND_CODE})(.*?)${SP}*(\{)${SP}*$`,
        end: endOr(re`${BOL}\s*(\})${SP}*$`),
        beginCaptures: {
          1: named('storage.modifier.visibility'),
          2: decl,
          3: nested('#class-header'),
          4: nested('#class-header'),
          5: blockBegin,
        },
        endCaptures: { 1: blockEnd },
        contentName: scope('meta.class.body'),
        patterns: [include('class-body')],
      },
      // class Foo … (members may follow in braces on the next line)
      nextLineBrace(
        re`\s*([-#+~])?${SP}*(${CLASS_TYPES_SINGLE})${SP}+(${NAME_AND_CODE})(.*?)${EOL}`,
        {
          1: named('storage.modifier.visibility'),
          2: decl,
          3: nested('#class-header'),
          4: nested('#class-header'),
        },
        classBodyOnNextLine
      ),
    ],
  },

  /** Names, generics, stereotypes, tags, links, colours, extends and implements. */
  'class-header': {
    patterns: [
      include('comment-inline'),
      include('stereotype'),
      lineColor,
      include('color'),
      { include: '#creole-inline' },
      { match: re`(?i)(?<![^\s${NBSP}])(extends|implements|as)(?![^\s${NBSP}])`, captures: { 1: kw } },
      { match: GENERIC, captures: { 0: nested('#class-generic') } },
      quotedName,
      tag,
      include('inline-preprocessor'),
      { name: scope('punctuation.separator.comma'), match: re`,` },
      { name: scope('entity.name.type'), match: re`[^\s${NBSP}{}"\x{201C}\x{201D}<>#,$\[\]]+` },
    ],
  },

  'class-generic': {
    patterns: [
      { name: scope('punctuation.definition.typeparameters'), match: re`[<>]` },
      { name: scope('punctuation.separator.comma'), match: re`,` },
      { name: scope('keyword.other'), match: re`(?i)\b(?:extends|super)\b` },
      { name: scope('entity.name.type'), match: re`[^\s${NBSP}<>,?]+` },
    ],
  },

  /** Lines between the braces of a class: separators and members. */
  'class-body': {
    patterns: [
      include('comment'),
      include('preprocessor'),
      include('embedded-diagram'),
      {
        // -- title --, == title ==, __ title __, .. title .. (not ...)
        match: re`${BOL}\s*(?:(--|==|__)(.*?)(\1)|(\.\.)(?!\.${SP}*$)(.*?)(\.\.))${SP}*$`,
        captures: {
          1: named('punctuation.separator.member'),
          2: nested('#label'),
          3: named('punctuation.separator.member'),
          4: named('punctuation.separator.member'),
          5: nested('#label'),
          6: named('punctuation.separator.member'),
        },
      },
      {
        // [modifiers] [visibility] member
        match: re`${BOL}\s*((?:${MODIFIER}${SP}*)*)(?:([-#+~*])(?!\2))?(.+?)${EOL}`,
        captures: {
          1: nested('#class-member-modifier'),
          2: named('storage.modifier.visibility'),
          3: nested('#class-member'),
        },
      },
      include('comment-inline'),
    ],
  },

  'class-member-modifier': {
    patterns: [{ name: scope('storage.modifier'), match: MODIFIER }],
  },

  /**
   * A field or a method: `name : Type`, `Type name`, `name(a : int) : void`,
   * `void name(int a)`, with stereotypes (IE keys) and links.
   */
  'class-member': {
    patterns: [
      include('comment-inline'),
      include('class-member-modifier'),
      include('stereotype'),
      { include: '#creole-inline' },
      include('inline-preprocessor'),
      include('class-member-parameters'),
      include('class-member-type'),
      { match: GENERIC, captures: { 0: nested('#class-generic') } },
      {
        match: re`([\p{L}\p{N}_$.\[\]]+)(?=${SP}*:)`,
        captures: { 1: named('variable.other.member') },
      },
      {
        match: re`([\p{L}\p{N}_$.]+(?:\[\])*)(?=${SP}+[\p{L}\p{N}_$])`,
        captures: { 1: typeName },
      },
      { name: scope('variable.other.member'), match: re`[\p{L}\p{N}_$.]+` },
    ],
  },

  /** `name(params)` of a method. */
  'class-member-parameters': {
    begin: re`([^\s${NBSP}(){}:,]+)?${SP}*(\()`,
    end: re`\)`,
    beginCaptures: {
      1: named('entity.name.function.member'),
      2: named('punctuation.definition.parameters.begin'),
    },
    endCaptures: { 0: named('punctuation.definition.parameters.end') },
    patterns: [include('class-member-parameter')],
  },

  /** `: Type` after a field, a parameter or a method. */
  'class-member-type': {
    match: re`(:)${SP}*([^\s${NBSP}:,()=]+(?:${SP}*${GENERIC})?(?:\[\])?)`,
    captures: { 1: named('punctuation.separator.type'), 2: nested('#class-type') },
  },

  'class-type': {
    patterns: [
      { match: GENERIC, captures: { 0: nested('#class-generic') } },
      { name: scope('entity.name.type'), match: re`[^<>\s${NBSP}]+` },
    ],
  },

  'class-member-parameter': {
    patterns: [
      include('stereotype'),
      include('class-member-type'),
      { match: GENERIC, captures: { 0: nested('#class-generic') } },
      { name: scope('punctuation.separator.comma'), match: re`,` },
      {
        match: re`([\p{L}\p{N}_$.]+(?:\[\])*)(?=${SP}+[\p{L}\p{N}_$])`,
        captures: { 1: typeName },
      },
      { name: scope('variable.parameter'), match: re`[\p{L}\p{N}_$.]+` },
    ],
  },

  // --- objects, maps, JSON ----------------------------------------------------

  'class-object': {
    patterns: [
      {
        begin: re`(?i)${BOL}\s*(object)${SP}+(.*?)${SP}*(\{)${SP}*$`,
        end: endOr(re`${BOL}\s*(\})${SP}*$`),
        beginCaptures: { 1: decl, 2: nested('#class-element-header'), 3: blockBegin },
        endCaptures: { 1: blockEnd },
        contentName: scope('meta.object.body'),
        patterns: [include('comment'), include('preprocessor'), include('class-object-field')],
      },
      {
        match: re`(?i)${BOL}\s*(object)${SP}+(.*?)${EOL}`,
        captures: { 1: decl, 2: nested('#class-element-header') },
      },
    ],
  },

  /** `name = value` inside an object; any other line is a field. */
  'class-object-field': {
    patterns: [
      {
        match: re`${BOL}\s*([^=]+?)${SP}*(=)${SP}*(.*?)${EOL}`,
        captures: {
          1: named('variable.other.member'),
          2: named('keyword.operator.assignment'),
          3: nested('#class-value'),
        },
      },
      {
        match: re`${BOL}\s*(.+?)${EOL}`,
        captures: { 1: nested('#class-member') },
      },
      include('comment-inline'),
    ],
  },

  'class-value': {
    patterns: [
      include('comment-inline'),
      include('string'),
      include('number'),
      { name: scope('constant.language'), match: re`(?i)\b(?:true|false|null)\b` },
      include('label'),
    ],
  },

  /** `"Display" as Code <<stereo>> [[url]] #color ##border` after object, map, json. */
  'class-element-header': {
    patterns: [
      include('comment-inline'),
      include('stereotype'),
      lineColor,
      include('color'),
      { include: '#creole-inline' },
      asKeyword,
      quotedName,
      include('inline-preprocessor'),
      { name: scope('entity.name.type'), match: re`[^\s${NBSP}{}"\x{201C}\x{201D}<>#\[\]]+` },
    ],
  },

  'class-map': {
    begin: re`(?i)${BOL}\s*(map)${SP}+(.*?)${SP}*(\{)${SP}*$`,
    end: endOr(re`${BOL}\s*(\})${SP}*$`),
    beginCaptures: { 1: decl, 2: nested('#class-element-header'), 3: blockBegin },
    endCaptures: { 1: blockEnd },
    contentName: scope('meta.map.body'),
    patterns: [
      include('comment'),
      include('preprocessor'),
      {
        // key => value
        match: re`${BOL}\s*(.*?)${SP}*(=>)${SP}*(.*?)${EOL}`,
        captures: {
          1: { name: scope('variable.other.member'), patterns: [include('label')] },
          2: named('keyword.operator.key-value'),
          3: nested('#label'),
        },
      },
      {
        // key *-> Target
        match: re`${BOL}\s*(.*?)${SP}*(\*-+_?>)${SP}*(.*?)${EOL}`,
        captures: {
          1: { name: scope('variable.other.member'), patterns: [include('label')] },
          2: named('keyword.operator.arrow'),
          3: typeName,
        },
      },
      include('comment-inline'),
    ],
  },

  'class-json': {
    patterns: [
      // json Name {"a": 1} and the other one-line values
      {
        match: re`(?i)${BOL}\s*(json)${SP}+((?:${QUOTED}${SP}+as${SP}+)?[\p{L}\p{N}_.]+)(${SP}*(?:<<.+?>>)?${SP}*(?:\[\[.*?\]\])?${SP}*(?:${COLORS})?)${SP}*((?:true|false|-?\d+|null|".*"|\[.*\]|\{${SP}*"(?:\\"|[^"])+"${SP}*:.*\}))${SP}*$`,
        captures: {
          1: decl,
          2: nested('#class-element-header'),
          3: nested('#class-element-header'),
          4: nested('#class-json-value'),
        },
      },
      // json Name { … } over several lines: the data ends where its braces balance.
      {
        begin: re`(?i)${BOL}\s*(json)${SP}+(.*?)${SP}*(?=\{${SP}*$)`,
        end: endOr(re`(?<=\})`),
        beginCaptures: { 1: decl, 2: nested('#class-element-header') },
        contentName: scope('meta.json'),
        patterns: [include('class-json-value')],
      },
    ],
  },

  'class-json-value': {
    patterns: [
      include('comment'),
      {
        begin: re`\{`,
        end: endOr(re`\}`),
        beginCaptures: { 0: named('punctuation.definition.dictionary.begin') },
        endCaptures: { 0: named('punctuation.definition.dictionary.end') },
        patterns: [
          include('comment'),
          {
            match: re`("(?:\\.|[^"\\])*")${SP}*(:)`,
            captures: {
              1: named('support.type.property-name'),
              2: named('punctuation.separator.dictionary.key-value'),
            },
          },
          include('class-json-value'),
        ],
      },
      {
        begin: re`\[`,
        end: endOr(re`\]`),
        beginCaptures: { 0: named('punctuation.definition.array.begin') },
        endCaptures: { 0: named('punctuation.definition.array.end') },
        patterns: [include('comment'), include('class-json-value')],
      },
      { name: scope('string.quoted.double'), match: re`"(?:\\.|[^"\\])*"` },
      { name: scope('constant.numeric'), match: re`-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?` },
      { name: scope('constant.language'), match: re`\b(?:true|false|null)\b` },
      { name: scope('punctuation.separator'), match: re`[,:]` },
    ],
  },

  // --- packages, namespaces, containers ----------------------------------------

  'class-container': {
    patterns: [
      // package Foo {} / namespace Foo {} — empty on one line.
      {
        match: re`(?i)${BOL}\s*(package|namespace)${SP}+(.*?)${SP}*(\{)${SP}*(\})${SP}*$`,
        captures: { 1: decl, 2: nested('#class-container-header'), 3: blockBegin, 4: blockEnd },
      },
      // [visibility] package / namespace / a container shape with a symbol, then {
      {
        match: re`(?i)${BOL}\s*([-#+~])?${SP}*(package|namespace|rectangle|hexagon|node|artifact|folder|file|frame|cloud|action|process|database|storage|component|card|queue|stack)(?:${SP}+(.*?))?${SP}*(\{)${SP}*$`,
        captures: {
          1: named('storage.modifier.visibility'),
          2: decl,
          3: nested('#class-container-header'),
          4: blockBegin,
        },
      },
      { match: re`(?i)${BOL}\s*(together)${SP}*(\{)${SP}*$`, captures: { 1: kw, 2: blockBegin } },
      // package Foo, with the brace on the next line
      nextLineBrace(
        re`\s*([-#+~])?${SP}*(package)${SP}+(${QUOTED}|[^#\s${NBSP}{}]+)(.*?)${EOL}`,
        {
          1: named('storage.modifier.visibility'),
          2: decl,
          3: nested('#class-container-header'),
          4: nested('#class-container-header'),
        },
        { match: re`${BOL}\s*(\{)${SP}*$`, captures: { 1: blockBegin } }
      ),
      // } closing a package, namespace, container or together
      { match: re`${BOL}\s*(\})${SP}*$`, captures: { 1: blockEnd } },
    ],
  },

  'class-container-header': {
    patterns: [
      include('comment-inline'),
      include('stereotype'),
      include('color'),
      { include: '#creole-inline' },
      asKeyword,
      quotedName,
      tag,
      include('inline-preprocessor'),
      { name: scope('entity.name.type'), match: re`[^\s${NBSP}{}"\x{201C}\x{201D}<>#\[\]]+` },
    ],
  },

  // --- links ----------------------------------------------------------------------

  'class-link': {
    patterns: [
      // A "1" *-- "many" B : label >, with qualifiers, roles, weights and (A, B) couples
      {
        match: re`${BOL}\s*(@[\d.]+${SP}+)?(${CLASS_ID}|${COUPLE})((?:${SP}+\[[^\[\]]+\]${SP}+)?)(${QUOTED})?(/(?:\S+|${QUOTED}))?${SP}*(${CLASS_ARROW})${SP}*(${QUOTED})?(/(?:\S+|${QUOTED}))?((?:${SP}+\[[^\[\]]+\]${SP}+)?)${SP}*(${CLASS_ID}|${COUPLE})(${LINK_TAIL})${EOL}`,
        captures: {
          1: named('constant.numeric.weight'),
          2: nested('#class-link-end'),
          3: nested('#class-link-qualifier'),
          4: nested('#string'),
          5: named('variable.other.role'),
          6: nested('#class-arrow'),
          7: nested('#string'),
          8: named('variable.other.role'),
          9: nested('#class-link-qualifier'),
          10: nested('#class-link-end'),
          11: nested('#class-link-tail'),
        },
      },
      // Lollipop: A ()-- B, A --() B
      {
        match: re`${BOL}\s*(@[\d.]+${SP}+)?(${CLASS_ID})${SP}*(${QUOTED})?${SP}*((?:[()]\)[-=.]+)|(?:[-=.]+\([()]))${SP}*(${QUOTED})?${SP}*(${CLASS_ID})(${SP}*(?::.*)?)${EOL}`,
        captures: {
          1: named('constant.numeric.weight'),
          2: nested('#class-link-end'),
          3: nested('#string'),
          4: named('keyword.operator.arrow'),
          5: nested('#string'),
          6: nested('#class-link-end'),
          7: nested('#class-link-tail'),
        },
      },
    ],
  },

  'class-link-end': {
    patterns: [
      { name: scope('punctuation.section.parens'), match: re`[(),]` },
      include('string'),
      include('inline-preprocessor'),
      { name: scope('entity.name.type'), match: re`[^\s${NBSP}(),"\x{201C}\x{201D}]+` },
    ],
  },

  'class-link-qualifier': {
    patterns: [
      {
        match: re`(\[)([^\[\]]+)(\])`,
        captures: {
          1: named('punctuation.definition.qualifier.begin'),
          2: named('variable.other.qualifier'),
          3: named('punctuation.definition.qualifier.end'),
        },
      },
    ],
  },

  /** The arrow of a link: style brackets, the rest is arrow. */
  'class-arrow': {
    patterns: [
      {
        match: re`(\[)(${LINE_STYLE}(?:;${LINE_STYLE})*)(\])`,
        captures: {
          1: named('keyword.operator.arrow punctuation.definition.style.begin'),
          2: {
            patterns: [{ name: scope('punctuation.separator.style'), match: re`;` }, include('line-style')],
          },
          3: named('keyword.operator.arrow punctuation.definition.style.end'),
        },
      },
      { name: scope('keyword.operator.arrow'), match: re`[^\[\]\s]+` },
    ],
  },

  'class-link-tail': {
    patterns: [include('comment-inline'), include('class-link-label'), include('color'), include('stereotype'), { include: '#creole-inline' }],
  },

  /** `: label`, where `<` or `>` at either end of the label show the reading direction. */
  'class-link-label': {
    match: re`(:)${SP}*(?:([<>])(?=${SP}))?(.*?)(?:(?<=${SP})([<>]))?${SP}*$`,
    captures: {
      1: named('punctuation.separator.label'),
      2: named('keyword.operator.direction'),
      3: nested('#label'),
      4: named('keyword.operator.direction'),
    },
  },

  // --- everything else --------------------------------------------------------------

  'class-misc': {
    patterns: [
      // Element shapes inside class diagrams (allow mixing): usecase X, mix_actor Y
      {
        match: re`(?i)${BOL}\s*((?:mix_)?(?:state|${ELEMENT_TYPES}))${SP}+(${ELEMENT_FORMS})(${ELEMENT_TAIL})${SP}*$`,
        captures: { 1: decl, 2: nested('#class-element-name'), 3: nested('#class-element-tail') },
      },
      // () Interface, () "Interface" as I
      {
        match: re`${BOL}\s*(\(\))${SP}+(${COLORS})?${SP}*(${ELEMENT_FORMS})(${ELEMENT_TAIL})${SP}*$`,
        captures: {
          1: decl,
          2: named('constant.other.color'),
          3: nested('#class-element-name'),
          4: nested('#class-element-tail'),
        },
      },
      // <> diamond
      {
        match: re`${BOL}\s*(<>)${SP}*([\p{L}\p{N}_.]+)${SP}*$`,
        captures: { 1: decl, 2: typeName },
      },
      // constraint on links : text
      {
        match: re`(?i)${BOL}\s*(constraint)${SP}*(on)${SP}+(links)${SP}*(${COLORS})?${SP}*(:)${SP}*(.*?)${EOL}`,
        captures: {
          1: kw,
          2: kw,
          3: kw,
          4: named('constant.other.color'),
          5: named('punctuation.separator.label'),
          6: nested('#label'),
        },
      },
      // Foo <<stereotype>> (after hide/show, which read `hide <<Foo>>`)
      {
        match: re`${BOL}\s*([\p{L}\p{N}_.]+|${QUOTED})${SP}*(<<.+>>)${SP}*$`,
        captures: { 1: nested('#class-link-end'), 2: nested('#stereotype') },
      },
      // Foo : member — adds a field or a method to an existing class
      {
        match: re`${BOL}\s*([\p{L}\p{N}_.]+|${QUOTED})${SP}+(:)${SP}+((?:${MODIFIER}${SP}*)*)(?:([-#+~*])(?!\4))?(.*?)${EOL}`,
        captures: {
          1: nested('#class-link-end'),
          2: named('punctuation.separator.label'),
          3: nested('#class-member-modifier'),
          4: named('storage.modifier.visibility'),
          5: nested('#class-added-member'),
        },
      },
      {
        match: re`(?i)${BOL}\s*(left${SP}to${SP}right|top${SP}to${SP}bottom)${SP}+(direction)${SP}*$`,
        captures: { 1: kw, 2: kw },
      },
      { match: re`(?i)${BOL}\s*(allow_?mixing)${SP}*$`, captures: { 1: kw } },
      { match: re`(?i)${BOL}\s*(layout_new_line)${SP}*$`, captures: { 1: kw } },
      { match: re`(?i)${BOL}\s*(newpage)${SP}*$`, captures: { 1: kw } },
      // url of Foo is [[http://…]]
      {
        match: re`(?i)${BOL}\s*(url)${SP}*(?:(of|for)\b)?${SP}+([\p{L}\p{N}_.]+|${QUOTED})${SP}+(?:(is)\b)?${SP}*(\[\[.*?\]\])${SP}*$`,
        captures: { 1: kw, 2: kw, 3: nested('#class-link-end'), 4: kw, 5: nested('#creole-inline') },
      },
    ],
  },

  /** Members added with `Foo : member`: no guessing of types from word order. */
  'class-added-member': {
    patterns: [
      include('comment-inline'),
      include('class-member-modifier'),
      include('stereotype'),
      { include: '#creole-inline' },
      include('inline-preprocessor'),
      include('class-member-parameters'),
      include('class-member-type'),
      include('label'),
    ],
  },

  'class-hide-target': {
    patterns: [
      include('stereotype'),
      include('string'),
      tag,
      { name: scope('keyword.other'), match: re`(?i)@?unlinked\b|time-axis\b|\*` },
      { name: scope('entity.name.type'), match: re`[^\s${NBSP}"<>]+` },
    ],
  },

  /** Element names: `as`, quoted displays, :actor:, (use case), [component], () interface. */
  'class-element-name': {
    patterns: [
      asKeyword,
      include('stereotype'),
      {
        name: scope('string.quoted.double'),
        match: re`(${DQ})(${NOT_DQ}+?)(${DQ})`,
        captures: {
          1: named('punctuation.definition.string.begin'),
          2: { name: scope('entity.name.type'), patterns: [include('label')] },
          3: named('punctuation.definition.string.end'),
        },
      },
      {
        match: re`(:)([^:]+)(:/?)|(\()([^()]+)(\)/?)|(\[)([^\[\]]+)(\])|(\(\))`,
        captures: {
          1: named('punctuation.definition.element.begin'),
          2: { name: scope('entity.name.type'), patterns: [include('label')] },
          3: named('punctuation.definition.element.end'),
          4: named('punctuation.definition.element.begin'),
          5: { name: scope('entity.name.type'), patterns: [include('label')] },
          6: named('punctuation.definition.element.end'),
          7: named('punctuation.definition.element.begin'),
          8: { name: scope('entity.name.type'), patterns: [include('label')] },
          9: named('punctuation.definition.element.end'),
          10: named('punctuation.definition.element'),
        },
      },
      include('inline-preprocessor'),
      { name: scope('entity.name.type'), match: re`[\p{L}\p{N}_.]+` },
    ],
  },

  'class-element-tail': {
    patterns: [include('comment-inline'), include('stereotype'), tag, include('color'), { include: '#creole-inline' }],
  },
};
