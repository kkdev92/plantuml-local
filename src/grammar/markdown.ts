/**
 * Injection into VS Code's Markdown grammar: the contents of the fenced
 * blocks that the preview renders as diagrams get the PlantUML grammar.
 *
 * The preview renders a fence when the first word of its info string is
 * exactly `plantuml` (see src/preview/plugin.ts), so this matches the same
 * blocks — not `puml`, not `PlantUML`. The fence itself follows
 * markdown-it: three or more backticks or tildes, no backtick in the info
 * string of a backtick fence, closed by the same character at least as
 * many times. Indentation is handled the way VS Code's own fenced blocks
 * are, so the two agree on where a block starts.
 */

import { PLANTUML_SCOPE } from './plantuml';
import { re, type Grammar, type Rule } from './rules';

export const MARKDOWN_INJECTION_SCOPE = 'markdown.plantuml-local.codeblock';

/** Scope of the diagram source inside the fence. */
export const EMBEDDED_SCOPE = 'meta.embedded.block.plantuml';

function fence(marker: '`' | '~'): Rule {
  const info = marker === '`' ? re`[^\x{60}]*` : re`.*`;
  const run = marker === '`' ? re`\x{60}` : '~';
  return {
    name: 'markup.fenced_code.block.markdown',
    begin: re`(^|\G)(\s*)(${run}{3,})[ \t]*(plantuml)(?:([ \t]+${info}))?$`,
    beginCaptures: {
      3: { name: 'punctuation.definition.markdown' },
      4: { name: 'fenced_code.block.language.markdown' },
      5: { name: 'fenced_code.block.language.attributes.markdown' },
    },
    end: re`(^|\G)(\2|\s{0,3})(\3${run}*)\s*$`,
    endCaptures: { 3: { name: 'punctuation.definition.markdown' } },
    patterns: [
      {
        begin: re`(^|\G)(\s*)(.*)`,
        while: re`(^|\G)(?!\s*([\x{60}~]{3,})\s*$)`,
        contentName: EMBEDDED_SCOPE,
        patterns: [{ include: PLANTUML_SCOPE }],
      },
    ],
  };
}

export const markdownInjectionGrammar: Grammar = {
  scopeName: MARKDOWN_INJECTION_SCOPE,
  // Not inside other code blocks, raw blocks or HTML comments: a fence
  // there is text, and the preview does not render it either.
  injectionSelector: 'L:text.html.markdown -markup.fenced_code -markup.raw -comment',
  patterns: [{ include: '#fence-backtick' }, { include: '#fence-tilde' }],
  repository: {
    'fence-backtick': fence('`'),
    'fence-tilde': fence('~'),
  },
};

export const MARKDOWN_FALLBACK_SCOPE = 'markdown.plantuml-local.codeblock-fallback';

/**
 * The same blocks, when another grammar has claimed the fence first.
 *
 * Some extensions inject a rule that takes every fence, whatever its
 * language, into all Markdown. Two injections that match at
 * the same place are settled by the order VS Code registered them in,
 * which follows the extensions' folder names, so the fence above can lose.
 * Such a rule stops after the backticks, like VS Code's own rule for an
 * unknown language; the info string is then read next, inside the block,
 * starting where that match ended (`\G`). From there to the closing fence
 * — which the other grammar closes — the lines are the diagram. A `while`
 * rather than an `end`: it is dropped before the closing line is read, so
 * the other grammar's end still matches there.
 */
export const markdownFallbackGrammar: Grammar = {
  scopeName: MARKDOWN_FALLBACK_SCOPE,
  // Not a fence inside another code block, a raw block or an HTML comment,
  // as above: the preview does not render those.
  injectionSelector:
    `L:markup.fenced_code.block.markdown -${EMBEDDED_SCOPE} ` +
    '-markup.fenced_code markup.fenced_code -markup.raw -comment',
  patterns: [
    {
      begin: re`\G[ \t]*(plantuml)(?=[ \t]|$).*$`,
      beginCaptures: { 1: { name: 'fenced_code.block.language.markdown' } },
      while: re`(^|\G)(?![ \t]*([\x{60}~]{3,})[ \t]*$)`,
      contentName: EMBEDDED_SCOPE,
      patterns: [{ include: PLANTUML_SCOPE }],
    },
  ],
  repository: {},
};
