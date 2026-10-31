import { describe, expect, it } from 'vitest';

import { NAMED_COLORS } from '../../src/core/colors';
import { englishMessages } from '../../src/core/messages';
import {
  propertyHelp,
  selectorText,
  settingAt,
  settingHelp,
  settingSuggestions,
  skinparamHelp,
  SKINPARAMS,
  STYLE_PROPERTIES,
  STYLE_RULES,
  styleExample,
  type SettingPlace,
  type StyleNames,
  type StyleRule,
} from '../../src/language/style';

/** Some of the names the engine gives, as the build reads them from it. */
const NAMES: StyleNames = {
  properties: ['FontName', 'FontColor', 'FontSize', 'BackGroundColor', 'LineColor', 'LineThickness', 'Shadowing', 'Padding'],
  selectors: ['root', 'element', 'sequenceDiagram', 'participant', 'arrow', 'classDiagram', 'class_', 'note'],
};

const rule = (...selectors: string[]): StyleRule => {
  const found = STYLE_RULES.find((candidate) => candidate.selectors.join(' ') === selectors.join(' '));
  expect(found, selectors.join(' ')).toBeDefined();
  return found as StyleRule;
};

/** Where the `|` of `lines` is, in a PlantUML file; `bare`, in a Markdown block. */
const placeOf = (lines: readonly string[], bare = true, names = NAMES): SettingPlace | null => {
  const line = lines.findIndex((text) => text.includes('|'));
  const column = lines[line]?.indexOf('|') ?? 0;
  return settingAt(lines.map((text) => text.replace('|', '')).join('\n'), line, column, bare, names);
};

/** `body` in a style sheet of a diagram. */
const sheet = (...body: string[]): string[] => ['@startuml', '<style>', ...body, '</style>', 'Alice -> Bob', '@enduml'];
const participant = (...body: string[]): string[] =>
  sheet('sequenceDiagram {', '  participant {', ...body.map((text) => `    ${text}`), '  }', '}');

describe('settingAt', () => {
  it('finds a property where a name can start in a rule it offers, replacing the name only', () => {
    expect(placeOf(participant('Font|Color: red;'))).toEqual({
      kind: 'property',
      rule: rule('sequenceDiagram', 'participant'),
      start: 4,
      end: 13,
    });
    expect(placeOf(participant('|'))).toMatchObject({ kind: 'property', start: 4, end: 4 });
    expect(placeOf(sheet('element { FontColor red; Line| }'))).toMatchObject({
      kind: 'property',
      rule: rule('element'),
      start: 25,
      end: 29,
    });
    expect(placeOf(sheet('classDiagram {', '  class {', '    Back|', '  }', '}'))).toMatchObject({
      kind: 'property',
      rule: rule('classDiagram', 'class_'),
    });
  });

  it('finds the value of a property it offers, written either way, replacing the value only', () => {
    expect(placeOf(participant('FontColor |'))).toEqual({
      kind: 'value',
      rule: rule('sequenceDiagram', 'participant'),
      property: 'FontColor',
      start: 14,
      end: 14,
    });
    // Up to the semicolon, which stays.
    expect(placeOf(participant('FontColor: #re|d;'))).toMatchObject({ kind: 'value', start: 15, end: 19 });
    expect(placeOf(sheet('sequenceDiagram { arrow { LineThickness 2| } }'))).toMatchObject({
      kind: 'value',
      property: 'LineThickness',
      start: 40,
      end: 41,
    });
  });

  it('reads selectors and properties in any case, as the engine finds them', () => {
    expect(placeOf(sheet('SEQUENCEDIAGRAM {', '  Participant {', '    fontcolor |', '  }', '}'))).toMatchObject({
      kind: 'value',
      property: 'FontColor',
    });
    expect(placeOf(sheet('classDiagram {', '  Class {', '    |', '  }', '}'))).toMatchObject({ kind: 'property' });
  });

  it('reads a source with CRLF line ends as one with LF', () => {
    const lines = participant('FontColor: #re|d;');
    const line = lines.findIndex((text) => text.includes('|'));
    const column = lines[line]?.indexOf('|') ?? 0;
    const source = lines.map((text) => text.replace('|', '')).join('\r\n');

    expect(settingAt(source, line, column, true, NAMES)).toEqual(placeOf(lines));
    expect(placeOf(lines)).toMatchObject({ kind: 'value', start: 15, end: 19 });
  });

  it('reads a Markdown block, which has no start line, as a diagram', () => {
    expect(placeOf(['<style>', 'element {', '  Font|', '}', '</style>'])).toMatchObject({ kind: 'property' });
    expect(placeOf(['<style>', 'element {', '  Font|', '}', '</style>'], false)).toBeNull();
  });

  it('finds nothing in a rule it does not offer, or one the engine reads otherwise', () => {
    for (const lines of [
      // Not a rule of the catalogue, or not all of one.
      sheet('note {', '  Font|', '}'),
      sheet('sequenceDiagram {', '  Font|', '}'),
      sheet('participant {', '  Font|', '}'),
      sheet('unknown {', '  Font|', '}'),
      // The engine does not apply `class_`, its own name for `class`.
      sheet('classDiagram {', '  class_ {', '    Font|', '  }', '}'),
      // Several selectors, a star, a stereotype, an @ rule.
      sheet('sequenceDiagram {', '  participant, arrow {', '    Font|', '  }', '}'),
      sheet('sequenceDiagram {', '  participant * {', '    Font|', '  }', '}'),
      sheet('sequenceDiagram {', '  participant.important {', '    Font|', '  }', '}'),
      sheet('@media dark {', '  element {', '    Font|', '  }', '}'),
      // Outside of any rule.
      sheet('Font|'),
    ]) {
      expect(placeOf(lines), lines.join('\n')).toBeNull();
    }
  });

  it('finds nothing after a statement the engine refuses, or a line of the preprocessor', () => {
    expect(placeOf(sheet('LineColor #ABC;', 'element {', '  Font|', '}'))).toBeNull();
    expect(placeOf(sheet('{', '}', 'element {', '  Font|', '}'))).toBeNull();
    expect(placeOf(sheet('element {', '!$accent = "#E00"', '  Font|', '}'))).toBeNull();
    // A comment line is no statement: the reading goes on past it.
    expect(placeOf(sheet('element {', "' a comment", '  Font|', '}'))).toMatchObject({ kind: 'property' });
  });

  it('finds nothing in a comment, quoted text, a variable, a function, a selector, or a value after a line break', () => {
    for (const lines of [
      participant('/* Font| */'),
      participant('// Font|'),
      participant('FontName "Cour|'),
      participant('FontColor $acc|'),
      participant('FontColor %darken(|'),
      participant('--accent |'),
      sheet('sequenceDiagram {', '  partic|ipant {', '  }', '}'),
      participant('FontColor', '|'),
      participant('Unknown |'),
    ]) {
      expect(placeOf(lines), lines.join('\n')).toBeNull();
    }
  });

  it('finds nothing in a style block that is text: in a note, quoted, or in data', () => {
    expect(placeOf(['@startuml', 'note over A', '<style>', 'element {', '  Font|', '}', '</style>', 'end note', '@enduml'])).toBeNull();
    expect(placeOf(['@startuml', 'A -> B : "<style>"', 'element {', '  Font|', '}', '@enduml'])).toBeNull();
    expect(placeOf(['@startjson', '{ "style": "<style>",', '"Font|": 1 }', '@endjson'])).toBeNull();
    expect(placeOf(["' <style>", '@startuml', 'element {', '  Font|', '}', '@enduml'])).toBeNull();
  });

  it('finds the skinparam a line sets, and the value of one it offers', () => {
    const at = (text: string): SettingPlace | null => placeOf(['@startuml', text, '@enduml']);

    expect(at('skinparam default|Font')).toEqual({ kind: 'skinparam', start: 10, end: 21 });
    expect(at('skinparam |')).toEqual({ kind: 'skinparam', start: 10, end: 10 });
    expect(at('skinparam defaultFontColor |')).toEqual({
      kind: 'skinparam value',
      skinparam: 'defaultFontColor',
      start: 27,
      end: 27,
    });
    expect(at('  SKINPARAM BackgroundColor #FF|F')).toEqual({
      kind: 'skinparam value',
      skinparam: 'backgroundColor',
      start: 28,
      end: 32,
    });
    for (const text of [
      'skinparam sequenceArrowThickness |',
      'skinparam backgroundColor<<Foo>> |',
      'skinparam defaultFontName Courier New|',
      'skinparam defaultFontColor $ac|',
      'skinparam backgroundColor "#FF|F"',
      'skin|param backgroundColor #FFF',
      'skinparam backgroundColor| #FFF',
      'skinparam sequence {',
      'title skinparam backgroundColor |',
    ]) {
      const place = at(text);
      // On the name itself, the name: the help says what it sets.
      if (text === 'skinparam backgroundColor| #FFF') {
        expect(place).toEqual({ kind: 'skinparam', start: 10, end: 25 });
      } else {
        expect(place, text).toBeNull();
      }
    }
    expect(placeOf(['@startuml', 'note over A', 'skinparam backgroundColor |', 'end note', '@enduml'])).toBeNull();
  });
});

describe('settingSuggestions', () => {
  const labels = (place: SettingPlace, typed = ''): string[] =>
    settingSuggestions(place, typed, NAMES, englishMessages).map(({ label }) => label);

  it('offers the properties of the rule, as the engine spells them, with their help', () => {
    const element = rule('element');
    const offered = settingSuggestions({ kind: 'property', rule: element, start: 0, end: 0 }, '', NAMES, englishMessages);

    expect(offered.map(({ label }) => label)).toEqual([
      'FontName',
      'FontSize',
      'FontColor',
      'BackGroundColor',
      'LineColor',
      'LineThickness',
    ]);
    expect(offered[2]).toMatchObject({ insert: 'FontColor', kind: 'property', help: propertyHelp(element, 'FontColor', englishMessages) });
    // No background for the arrows of a sequence diagram, which the engine does not draw.
    expect(labels({ kind: 'property', rule: rule('sequenceDiagram', 'arrow'), start: 0, end: 0 })).not.toContain('BackGroundColor');
  });

  it('offers only the properties the engine knows', () => {
    const fewer: StyleNames = { ...NAMES, properties: ['FontColor', 'LineColor'] };
    const offered = settingSuggestions({ kind: 'property', rule: rule('element'), start: 0, end: 0 }, '', fewer, englishMessages);

    expect(offered.map(({ label }) => label)).toEqual(['FontColor', 'LineColor']);
  });

  it('offers values of the kind the property takes', () => {
    const value = (property: keyof typeof STYLE_PROPERTIES): SettingPlace => ({
      kind: 'value',
      rule: rule('element'),
      property,
      start: 0,
      end: 0,
    });

    expect(labels(value('FontName'))).toEqual(['sans-serif', 'serif', 'monospace']);
    expect(labels(value('FontSize'))).toEqual(['10', '12', '14', '16', '18', '20', '24']);
    expect(labels(value('LineThickness'))).toEqual(['0.5', '1', '1.5', '2', '3']);
    const colours = settingSuggestions(value('LineColor'), '', NAMES, englishMessages);
    expect(colours).toHaveLength(Object.keys(NAMED_COLORS).length);
    expect(colours.find(({ label }) => label === '#tomato')).toEqual({
      label: '#tomato',
      insert: '#tomato',
      kind: 'color',
      detail: '#FF6347',
    });
  });

  it('offers a colour in the form being typed: with # when nothing is, or #, and bare after a letter', () => {
    const place: SettingPlace = { kind: 'value', rule: rule('element'), property: 'FontColor', start: 0, end: 0 };

    expect(labels(place, '#to')).toContain('#tomato');
    expect(labels(place, 'to')).toContain('tomato');
    expect(labels(place, 'to')).not.toContain('#tomato');
  });

  it('offers the skinparams, with their help, and the values of each', () => {
    const offered = settingSuggestions({ kind: 'skinparam', start: 0, end: 0 }, '', NAMES, englishMessages);

    expect(offered.map(({ label }) => label)).toEqual(['defaultFontName', 'defaultFontSize', 'defaultFontColor', 'backgroundColor']);
    expect(offered[0]?.help).toEqual(skinparamHelp('defaultFontName', englishMessages));
    expect(labels({ kind: 'skinparam value', skinparam: 'defaultFontSize', start: 0, end: 0 })).toContain('20');
    expect(labels({ kind: 'skinparam value', skinparam: 'backgroundColor', start: 0, end: 0 })).toContain('#white');
  });
});

describe('the help on style items', () => {
  it('says what the property sets, where, what it takes, and shows it written both ways', () => {
    const help = propertyHelp(rule('sequenceDiagram', 'arrow'), 'LineThickness', englishMessages);

    expect(help.title).toBe('LineThickness');
    expect(help.text).toContain('The width of the lines');
    expect(help.text).toContain('the arrows of a sequence diagram');
    expect(help.text).toContain('It takes a number');
    expect(help.syntax).toBe('LineThickness: 2.5;\nLineThickness 2.5');
    expect(help.example).toBe(styleExample(rule('sequenceDiagram', 'arrow'), 'LineThickness', '2.5').join('\n'));
  });

  it('says that the engine reads a font size as a whole number, and which fonts are found everywhere', () => {
    expect(propertyHelp(rule('element'), 'FontSize', englishMessages).text).toContain('12.5 as 125');
    expect(propertyHelp(rule('element'), 'FontName', englishMessages).text).toContain('sans-serif, serif and monospace');
  });

  it('says that PlantUML recommends a style block over skinparam', () => {
    const help = skinparamHelp('backgroundColor', englishMessages);

    expect(help.title).toBe('skinparam backgroundColor');
    expect(help.text).toContain('recommends a <style> block');
    expect(help.syntax).toBe('skinparam backgroundColor #FFF3E0');
  });

  it('is the help of the name at the place, in any case, and none on a value or an unknown name', () => {
    const participantRule = rule('sequenceDiagram', 'participant');
    const line = '    fontcolor: red;';

    expect(settingHelp({ kind: 'property', rule: participantRule, start: 4, end: 13 }, line, NAMES, englishMessages)).toEqual(
      propertyHelp(participantRule, 'FontColor', englishMessages)
    );
    expect(settingHelp({ kind: 'property', rule: participantRule, start: 4, end: 8 }, line, NAMES, englishMessages)).toBeNull();
    expect(
      settingHelp({ kind: 'value', rule: participantRule, property: 'FontColor', start: 15, end: 18 }, line, NAMES, englishMessages)
    ).toBeNull();
    expect(settingHelp({ kind: 'skinparam', start: 10, end: 25 }, 'skinparam BACKGROUNDCOLOR red', NAMES, englishMessages)).toEqual(
      skinparamHelp('backgroundColor', englishMessages)
    );
    expect(settingHelp({ kind: 'skinparam', start: 10, end: 18 }, 'skinparam shadowing true', NAMES, englishMessages)).toBeNull();
  });
});

describe('the catalogue', () => {
  it('writes an example with the selectors nested, `class_` as the engine reads it', () => {
    expect(styleExample(rule('classDiagram', 'class_'), 'FontColor', '#C62828')).toEqual([
      '<style>',
      'classDiagram {',
      '  class {',
      '    FontColor: #C62828;',
      '  }',
      '}',
      '</style>',
      'class Order {',
      '  +id : int',
      '}',
      'class Customer',
      'Customer --> Order : places',
    ]);
    expect(styleExample(rule('element'), 'FontSize', '20', 'space', 'sequence').slice(0, 5)).toEqual([
      '<style>',
      'element {',
      '  FontSize 20',
      '}',
      '</style>',
    ]);
    expect(selectorText('class_')).toBe('class');
  });

  it('offers no shadow, which the engine does not draw, and each property in the kind of value it takes', () => {
    expect(Object.keys(STYLE_PROPERTIES)).not.toContain('Shadowing');
    expect(Object.keys(SKINPARAMS).map((name) => name.toLowerCase())).not.toContain('shadowing');
    expect(STYLE_RULES.flatMap(({ properties }) => properties)).not.toContain('Shadowing');
    expect(Object.fromEntries(Object.entries(STYLE_PROPERTIES).map(([name, { kind }]) => [name, kind]))).toEqual({
      FontName: 'font',
      FontSize: 'integer',
      FontColor: 'color',
      BackGroundColor: 'color',
      LineColor: 'color',
      LineThickness: 'number',
    });
  });
});
