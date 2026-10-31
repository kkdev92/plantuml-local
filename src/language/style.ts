/**
 * What the completion and the hovers offer for the look of a diagram: the
 * properties of a few rules of a `<style>` block, and four `skinparam`
 * names, kept for the diagrams that set them.
 *
 * The names are the engine's: the properties and selectors of a style
 * that its plantuml.js knows, which the build reads from it
 * (scripts/style-names.mjs) into dist/engine/style-names.json, in its
 * spelling. Kept here is which rule offers which property — those the
 * bundled engine draws, as test/integration/worker.test.ts checks for
 * each, written either way, on every engine update — the kind of value
 * each takes, the values offered for it and its help, written for the
 * engine HELP_ENGINE names. The engine draws no background for the arrows
 * of a sequence diagram and no shadow for `Shadowing`, so neither is
 * offered.
 *
 * A style sheet is read as the engine reads it (src/core/style-sheet.ts),
 * from its start line up to the cursor. Nothing is offered where that
 * reading cannot be sure what the cursor is in: in a rule of several
 * selectors, with a `*`, a stereotype, a selector the engine does not know
 * or an `@` rule around it; after a line of the preprocessor, which may
 * change the lines; after a statement the engine refuses; in quoted text,
 * a comment, a variable, or a value that uses a variable or a function.
 * Only the name or the value at the cursor is replaced.
 *
 * Like the completion, this has no dependency on the `vscode` module.
 */

import { NAMED_COLORS } from '../core/colors';
import { splitLines } from '../core/lines';
import type { MessageLocalizer } from '../core/messages';
import { readStyleSheet, type OpenRule } from '../core/style-sheet';
import { diagramAt } from './completion';
import type { Help } from './hover';
import { protect, protectedAt, type CodeLine } from './protected';

/** The names the bundled engine gives the properties and the selectors of a style (dist/engine/style-names.json). */
export interface StyleNames {
  properties: readonly string[];
  selectors: readonly string[];
}

/** What a value is: the name of a font, a whole number, a number, or a colour. */
export type ValueKind = 'font' | 'integer' | 'number' | 'color';

/** The properties offered, by the engine's names: the kind of value each takes, and the value its help shows. */
export const STYLE_PROPERTIES = {
  FontName: { kind: 'font', example: 'serif' },
  FontSize: { kind: 'integer', example: '20' },
  FontColor: { kind: 'color', example: '#C62828' },
  BackGroundColor: { kind: 'color', example: '#FFF3E0' },
  LineColor: { kind: 'color', example: '#1565C0' },
  LineThickness: { kind: 'number', example: '2.5' },
} as const satisfies Readonly<Record<string, { kind: ValueKind; example: string }>>;

export type OfferedProperty = keyof typeof STYLE_PROPERTIES;

/** The lines of a small diagram of each kind, which the examples style. */
export const EXAMPLE_BODIES = {
  sequence: ['participant Alice', 'participant Bob', 'Alice -> Bob : hello'],
  class: ['class Order {', '  +id : int', '}', 'class Customer', 'Customer --> Order : places'],
} as const;

/**
 * A rule that offers properties: its selectors, outermost first, by the
 * engine's names; the kinds of diagram the bundled engine is checked to
 * draw it in, the first being the one its examples show; and its
 * properties.
 */
export interface StyleRule {
  selectors: readonly string[];
  drawnIn: readonly (keyof typeof EXAMPLE_BODIES)[];
  properties: readonly OfferedProperty[];
}

const ALL: readonly OfferedProperty[] = ['FontName', 'FontSize', 'FontColor', 'BackGroundColor', 'LineColor', 'LineThickness'];

export const STYLE_RULES: readonly StyleRule[] = [
  { selectors: ['element'], drawnIn: ['sequence', 'class'], properties: ALL },
  { selectors: ['sequenceDiagram', 'participant'], drawnIn: ['sequence'], properties: ALL },
  {
    selectors: ['sequenceDiagram', 'arrow'],
    drawnIn: ['sequence'],
    properties: ALL.filter((property) => property !== 'BackGroundColor'),
  },
  { selectors: ['classDiagram', 'class_'], drawnIn: ['class'], properties: ALL },
];

/** The `skinparam` names offered: the kind of value each takes, and the value its help shows. */
export const SKINPARAMS = {
  defaultFontName: { kind: 'font', example: 'serif' },
  defaultFontSize: { kind: 'integer', example: '20' },
  defaultFontColor: { kind: 'color', example: '#C62828' },
  backgroundColor: { kind: 'color', example: '#FFF3E0' },
} as const satisfies Readonly<Record<string, { kind: ValueKind; example: string }>>;

export type OfferedSkinparam = keyof typeof SKINPARAMS;

/** The values offered for each kind but colours, whose values are the names the engine knows. */
const VALUES: Readonly<Record<Exclude<ValueKind, 'color'>, readonly string[]>> = {
  // The generic families, which the engine writes as they are, and which
  // have a font wherever the diagram is shown.
  font: ['sans-serif', 'serif', 'monospace'],
  integer: ['10', '12', '14', '16', '18', '20', '24'],
  number: ['0.5', '1', '1.5', '2', '3'],
};

/** A selector as it is written: the engine's name without the `_` that keeps it from being a Java keyword. */
export const selectorText = (name: string): string => name.replaceAll('_', '');

/**
 * The lines of a diagram that set `property` of `rule` to `value`, written
 * `Name: value;` or, with `form` `space`, `Name value`, in a diagram of the
 * kind `kind`.
 */
export function styleExample(
  rule: StyleRule,
  property: string,
  value: string,
  form: 'colon' | 'space' = 'colon',
  kind: keyof typeof EXAMPLE_BODIES = rule.drawnIn[0] ?? 'sequence'
): string[] {
  const depth = rule.selectors.length;
  return [
    '<style>',
    ...rule.selectors.map((name, at) => `${'  '.repeat(at)}${selectorText(name)} {`),
    `${'  '.repeat(depth)}${form === 'colon' ? `${property}: ${value};` : `${property} ${value}`}`,
    ...rule.selectors.map((_, at) => `${'  '.repeat(depth - 1 - at)}}`),
    '</style>',
    ...EXAMPLE_BODIES[kind],
  ];
}

/** Where the cursor is among what is offered for the look of a diagram, and the columns of the name or the value it replaces. */
export type SettingPlace =
  | { kind: 'property'; rule: StyleRule; start: number; end: number }
  | { kind: 'value'; rule: StyleRule; property: OfferedProperty; start: number; end: number }
  | { kind: 'skinparam'; start: number; end: number }
  | { kind: 'skinparam value'; skinparam: OfferedSkinparam; start: number; end: number };

/** The rule of {@link STYLE_RULES} that the rules open at the cursor make, as the engine finds a selector (SName.retrieve): in any case. */
function ruleOf(open: readonly OpenRule[], names: StyleNames): StyleRule | null {
  const path: string[] = [];
  for (const { selectors, star, at } of open) {
    const written = selectors.length === 1 && !star && !at ? selectors[0]?.toLowerCase() : undefined;
    const name = names.selectors.find((known) => selectorText(known).toLowerCase() === written);
    if (name === undefined) {
      return null;
    }
    path.push(name);
  }
  return (
    STYLE_RULES.find(
      ({ selectors }) => selectors.length === path.length && selectors.every((name, at) => name === path[at])
    ) ?? null
  );
}

/** The properties of `rule` that the engine knows. */
const offered = (rule: StyleRule, names: StyleNames): OfferedProperty[] =>
  rule.properties.filter((name) => names.properties.includes(name));

/** The property of `rule` written `written`, in any case, as the engine finds one (PName.getFromName). */
const propertyOf = (rule: StyleRule, written: string, names: StyleNames): OfferedProperty | null =>
  offered(rule, names).find((name) => name.toLowerCase() === written.toLowerCase()) ?? null;

/** What follows a selector's name: a comma, a `*` or a brace. */
const SELECTOR_FOLLOWS = /^[ \t]*[,*{]/;
/** A value that may be read otherwise: quoted, or holding a variable or a function, which the preprocessor replaces. */
const UNSURE_VALUE = /["$%(!]/;

/** The place of the cursor at `column` of line `here` of a style sheet, the lines of whose diagram are `lines`. */
function inSheet(
  lines: readonly string[],
  code: readonly CodeLine[],
  here: number,
  column: number,
  names: StyleNames
): SettingPlace | null {
  let open = here;
  while (open >= 0 && code[open]?.style !== 'open') {
    open -= 1;
  }
  const sheet: string[] = [];
  for (let at = open + 1; at <= here; at++) {
    const text = lines[at] ?? '';
    const read = code[at]?.style === 'sheet';
    // A line of the preprocessor may change the lines the engine reads.
    if (read && /^\s*!/.test(text)) {
      return null;
    }
    sheet.push(read ? text : '');
  }
  const { refused, open: rules, pending } = readStyleSheet(sheet, { line: sheet.length - 1, column });
  const rule = refused ? null : ruleOf(rules, names);
  const text = lines[here] ?? '';
  if (rule === null) {
    return null;
  }
  if (pending.kind === 'statement' || pending.kind === 'name') {
    const start = pending.kind === 'name' ? pending.start : column;
    const rest = /^[A-Za-z]*/.exec(text.slice(column))?.[0] ?? '';
    const end = column + rest.length;
    return /^[A-Za-z]*$/.test(text.slice(start, column)) && !SELECTOR_FOLLOWS.test(text.slice(end))
      ? { kind: 'property', rule, start, end }
      : null;
  }
  if (pending.kind === 'value') {
    const property = propertyOf(rule, pending.name, names);
    const end = Math.max(column, pending.start + (/^[^;{}]*/.exec(text.slice(pending.start))?.[0].trimEnd().length ?? 0));
    return property === null || UNSURE_VALUE.test(text.slice(pending.start, end))
      ? null
      : { kind: 'value', rule, property, start: pending.start, end };
  }
  return null;
}

/** A `skinparam` line, up to the name it sets and the white space after the name. */
const SKINPARAM_LINE = /^(\s*skinparam\s+)([A-Za-z]*)(\s*)/i;

/** The place of the cursor at `column` of `text`, a line of a diagram, on a `skinparam` line. */
function onSkinparam(text: string, line: CodeLine, column: number): SettingPlace | null {
  const match = SKINPARAM_LINE.exec(text);
  if (match === null || protectedAt(line, column)) {
    return null;
  }
  const start = (match[1] ?? '').length;
  const end = start + (match[2] ?? '').length;
  if (column >= start && column <= end) {
    return { kind: 'skinparam', start, end };
  }
  const skinparam = (Object.keys(SKINPARAMS) as OfferedSkinparam[]).find(
    (name) => name.toLowerCase() === (match[2] ?? '').toLowerCase()
  );
  const from = end + (match[3] ?? '').length;
  if (skinparam === undefined || from === end || column < from) {
    return null;
  }
  const to = Math.max(column, from + text.slice(from).trimEnd().length);
  return /[\s"$%(!{]/.test(text.slice(from, to).trimEnd())
    ? null
    : { kind: 'skinparam value', skinparam, start: from, end: to };
}

/**
 * Where the cursor at `column` of line `line` of `source` is among what is
 * offered for the look of a diagram, or null. `bare` is a Markdown block,
 * which is a diagram without a start line.
 */
export function settingAt(
  source: string,
  line: number,
  column: number,
  bare: boolean,
  names: StyleNames
): SettingPlace | null {
  const diagram = diagramAt(source, line, bare);
  if (diagram === null || diagram.data) {
    return null;
  }
  const lines = splitLines(source).slice(diagram.from, diagram.to);
  const code = protect(lines, false);
  const here = line - diagram.from;
  const current = code[here];
  if (current === undefined) {
    return null;
  }
  return current.style === 'sheet'
    ? inSheet(lines, code, here, column, names)
    : onSkinparam(lines[here] ?? '', current, column);
}

/** One suggestion for the look of a diagram. */
export interface SettingSuggestion {
  label: string;
  insert: string;
  kind: 'property' | 'skinparam' | 'value' | 'color';
  /** A colour's `#RRGGBB`, from which VS Code shows a swatch beside it. */
  detail?: string;
  /** The help on a property or a skinparam. */
  help?: Help;
}

/** What a value of each kind is, localised. */
function valueText(kind: ValueKind, l10n: MessageLocalizer): string {
  switch (kind) {
    case 'font':
      return l10n.t(
        'It takes the name of a font: sans-serif, serif and monospace are drawn in a font of that kind wherever the diagram is shown, any other font only where it is installed.'
      );
    case 'integer':
      return l10n.t('It takes a whole number: the engine reads 12.5 as 125.');
    case 'number':
      return l10n.t('It takes a number, such as 0.5 or 2.');
    case 'color':
      return l10n.t('It takes a colour: # and three or six hex digits, or a name the engine knows, such as #tomato.');
  }
}

/** What a property sets, localised. */
function propertyText(property: OfferedProperty, l10n: MessageLocalizer): string {
  switch (property) {
    case 'FontName':
      return l10n.t('The font of the text.');
    case 'FontSize':
      return l10n.t('The size of the text.');
    case 'FontColor':
      return l10n.t('The colour of the text.');
    case 'BackGroundColor':
      return l10n.t('The colour that fills the shape.');
    case 'LineColor':
      return l10n.t("The colour of the lines: a shape's outline, or an arrow.");
    case 'LineThickness':
      return l10n.t("The width of the lines: a shape's outline, or an arrow.");
  }
}

/** What a rule applies to, localised, by its innermost selector. */
function ruleText(rule: StyleRule, l10n: MessageLocalizer): string {
  switch (rule.selectors.at(-1)) {
    case 'participant':
      return l10n.t('In this rule, it applies to the participants of a sequence diagram.');
    case 'arrow':
      return l10n.t('In this rule, it applies to the arrows of a sequence diagram and the text on them.');
    case 'class_':
      return l10n.t('In this rule, it applies to the classes of a class diagram.');
    default:
      return l10n.t('In this rule, it applies to the elements of a diagram, such as participants and classes.');
  }
}

/** What a skinparam sets, localised. */
function skinparamText(skinparam: OfferedSkinparam, l10n: MessageLocalizer): string {
  switch (skinparam) {
    case 'defaultFontName':
      return l10n.t('The font of the text of the whole diagram.');
    case 'defaultFontSize':
      return l10n.t('The size of the text of the whole diagram.');
    case 'defaultFontColor':
      return l10n.t('The colour of the text of the whole diagram.');
    case 'backgroundColor':
      return l10n.t('The colour of the background of the whole diagram.');
  }
}

/** The help on `property` of `rule`: what it sets there, what it takes, and how it is written. */
export function propertyHelp(rule: StyleRule, property: OfferedProperty, l10n: MessageLocalizer): Help {
  const { kind, example } = STYLE_PROPERTIES[property];
  return {
    title: property,
    text: [propertyText(property, l10n), ruleText(rule, l10n), valueText(kind, l10n)].join(' '),
    syntax: [`${property}: ${example};`, `${property} ${example}`].join('\n'),
    example: styleExample(rule, property, example).join('\n'),
  };
}

/** The lines of a diagram that set `skinparam` to `value`. */
export function skinparamExample(skinparam: string, value: string): string[] {
  return [`skinparam ${skinparam} ${value}`, ...EXAMPLE_BODIES.sequence];
}

/** The help on `skinparam`: what it sets, what it takes, and how it is written. */
export function skinparamHelp(skinparam: OfferedSkinparam, l10n: MessageLocalizer): Help {
  const { kind, example } = SKINPARAMS[skinparam];
  return {
    title: `skinparam ${skinparam}`,
    text: [
      skinparamText(skinparam, l10n),
      valueText(kind, l10n),
      l10n.t('PlantUML still reads skinparam, and recommends a <style> block instead.'),
    ].join(' '),
    syntax: `skinparam ${skinparam} ${example}`,
    example: skinparamExample(skinparam, example).join('\n'),
  };
}

/**
 * The help on what the cursor is on, where `place` is: a property a rule
 * offers, or a skinparam offered; null elsewhere. `written` is the line of
 * the diagram.
 */
export function settingHelp(place: SettingPlace, written: string, names: StyleNames, l10n: MessageLocalizer): Help | null {
  const name = written.slice(place.start, place.end);
  if (place.kind === 'property') {
    const property = propertyOf(place.rule, name, names);
    return property === null ? null : propertyHelp(place.rule, property, l10n);
  }
  if (place.kind === 'skinparam') {
    const skinparam = (Object.keys(SKINPARAMS) as OfferedSkinparam[]).find(
      (offeredName) => offeredName.toLowerCase() === name.toLowerCase()
    );
    return skinparam === undefined ? null : skinparamHelp(skinparam, l10n);
  }
  return null;
}

/**
 * The suggestions where `place` is, `typed` being what is written there up
 * to the cursor: the properties a rule offers, the skinparams, or the
 * values of a property or a skinparam. A colour is offered in the form
 * being typed: with `#`, as the colour picker shows it, or without, as
 * PlantUML's own examples of a style write a name.
 */
export function settingSuggestions(
  place: SettingPlace,
  typed: string,
  names: StyleNames,
  l10n: MessageLocalizer
): SettingSuggestion[] {
  const values = (kind: ValueKind): SettingSuggestion[] => {
    if (kind !== 'color') {
      return VALUES[kind].map((value) => ({ label: value, insert: value, kind: 'value' }));
    }
    const hash = typed === '' || typed.startsWith('#') ? '#' : '';
    return Object.entries(NAMED_COLORS).map(([name, hex]) => ({
      label: `${hash}${name}`,
      insert: `${hash}${name}`,
      kind: 'color',
      detail: hex,
    }));
  };
  switch (place.kind) {
    case 'property':
      return offered(place.rule, names).map((property) => ({
        label: property,
        insert: property,
        kind: 'property',
        help: propertyHelp(place.rule, property, l10n),
      }));
    case 'value':
      return values(STYLE_PROPERTIES[place.property].kind);
    case 'skinparam':
      return (Object.keys(SKINPARAMS) as OfferedSkinparam[]).map((skinparam) => ({
        label: skinparam,
        insert: skinparam,
        kind: 'skinparam',
        help: skinparamHelp(skinparam, l10n),
      }));
    case 'skinparam value':
      return values(SKINPARAMS[place.skinparam].kind);
  }
}
