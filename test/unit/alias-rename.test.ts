import { describe, expect, it } from 'vitest';

import { RENAME_LIMITS } from '../../src/core/constants';
import { newNameRefusal, renameAt, type RenameRefusal, type RenameTarget } from '../../src/language/alias-rename';

const NBSP = String.fromCharCode(0xa0);
/** Where the cursor is, in a document written for a test. */
const CURSOR = '§';

/** A Markdown document whose one block holds `lines` between `@startuml` and `@enduml`. */
function doc(...lines: string[]): string {
  return ['# Orders', '', '```plantuml', '@startuml', ...lines, '@enduml', '```', ''].join('\n');
}

/** The line of {@link doc} that holds the first of the lines given to it. */
const FIRST = 4;

/** `text` without its cursor, and the line and column of the cursor. */
function placed(text: string): { text: string; line: number; character: number } {
  const index = text.indexOf(CURSOR);
  if (index === -1 || text.includes(CURSOR, index + 1)) {
    throw new Error('mark the cursor once');
  }
  const before = text.slice(0, index);
  return {
    text: before + text.slice(index + 1),
    line: before.split('\n').length - 1,
    character: index - before.lastIndexOf('\n') - 1,
  };
}

/** `text` with the cursor kept at the first of its places: for lines that name the alias many times. */
function once(text: string): string {
  const first = text.indexOf(CURSOR);
  return text.slice(0, first + 1) + text.slice(first + 1).split(CURSOR).join('');
}

/** What a rename at the cursor of `text` finds. */
function at(text: string): ReturnType<typeof renameAt> {
  const { text: plain, line, character } = placed(text);
  return renameAt(plain, line, character);
}

/** The alias at the cursor of `text`, which can be renamed. */
function target(text: string): RenameTarget {
  const found = at(text);
  if (found === null || 'refused' in found) {
    throw new Error(`no alias to rename: ${JSON.stringify(found)}`);
  }
  return found;
}

/** Why a rename at the cursor of `text` is refused. */
function refusal(text: string): RenameRefusal {
  const found = at(text);
  if (found === null || !('refused' in found)) {
    throw new Error(`not refused: ${JSON.stringify(found)}`);
  }
  return found.refused;
}

/** `text` once the alias at its cursor is renamed to `name`, as the edits change it. */
function renamed(text: string, name: string): string {
  const found = target(text);
  expect(newNameRefusal(found, name)).toBeNull();
  const lines = placed(text).text.split('\n');
  for (const { line, start, end } of [...found.places].reverse()) {
    const old = lines[line] ?? '';
    expect(old.slice(start, end)).toBe(found.alias);
    lines[line] = old.slice(0, start) + name + old.slice(end);
  }
  return lines.join('\n');
}

/** A diagram that can be renamed in: the lines the tests of refusals add come after it. */
const BASE = ['participant "Orders desk" as §A', 'A -> B : order'];

describe('renaming an alias', () => {
  it('changes the alias where it is declared and where messages use it, and not the label', () => {
    expect(renamed(doc('participant "注文窓口" as §A', 'A -> B : Aという表示'), 'Orders')).toBe(
      doc('participant "注文窓口" as Orders', 'Orders -> B : Aという表示')
    );
  });

  it.each(['participant "Orders desk" as §A', 'participant "Orders desk" as A§', '§A -> B : order', 'A§ -> B : order'])(
    'finds the alias from %s',
    (line) => {
      const lines = BASE.map((base) => base.replace(CURSOR, ''));
      const text = doc(...lines.map((base) => (base === line.replace(CURSOR, '') ? line : base)));
      const found = target(text);
      expect(found.alias).toBe('A');
      expect(found.places).toEqual([
        { line: FIRST, start: 29, end: 30 },
        { line: FIRST + 1, start: 0, end: 1 },
      ]);
    }
  );

  it.each([
    ['participant "Orders desk" as §A', 'participant "Orders desk" as Orders'],
    ['participant §A as "Orders desk"', 'participant Orders as "Orders desk"'],
    ['participant Desk as §A', 'participant Desk as Orders'],
    ['participant Desk As §A', 'participant Desk As Orders'],
    ['PARTICIPANT "Orders desk" AS §A', 'PARTICIPANT "Orders desk" AS Orders'],
    ['participant\t"Orders desk"\tas\t§A', 'participant\t"Orders desk"\tas\tOrders'],
    ['participant "Orders desk" as §A order 20', 'participant "Orders desk" as Orders order 20'],
    ['participant §A as "Orders desk" order -3', 'participant Orders as "Orders desk" order -3'],
    ['participant Desk as §A order 7', 'participant Desk as Orders order 7'],
    ['actor "Orders desk" as §A', 'actor "Orders desk" as Orders'],
    ['boundary "Orders desk" as §A', 'boundary "Orders desk" as Orders'],
    ['control "Orders desk" as §A', 'control "Orders desk" as Orders'],
    ['entity "Orders desk" as §A', 'entity "Orders desk" as Orders'],
    ['database "Orders desk" as §A', 'database "Orders desk" as Orders'],
    ['collections "Orders desk" as §A', 'collections "Orders desk" as Orders'],
    ['queue "Orders desk" as §A', 'queue "Orders desk" as Orders'],
  ])('renames an alias declared as %s', (declaration, expected) => {
    expect(renamed(doc(declaration, 'A -> B : order'), 'Orders')).toBe(doc(expected, 'Orders -> B : order'));
  });

  it('changes each line that names it, and only the name on it', () => {
    const before = doc(
      'participant "Orders desk" as §A',
      'participant B',
      'A -> B : order',
      'B --> A : done',
      'activate A',
      'deactivate A',
      'create C',
      'A -> C : new',
      'note left of A : A waits',
      'note right of A : A',
      'note over A : A',
      'note over A, B : A and B',
      'note over B,A : B and A',
      'note left of A',
      'A -> B : in the note',
      'end note',
      'note over A, B',
      'A -> B : in the note',
      'end note',
      'ref over A, B : A and B',
      'ref over B, A',
      'A -> B : in the reference',
      'end ref',
      'alt A is open',
      'A -> B : one',
      'else A is closed',
      'A -> B : two',
      'end',
      'destroy A'
    );
    const after = doc(
      'participant "Orders desk" as Orders',
      'participant B',
      'Orders -> B : order',
      'B --> Orders : done',
      'activate Orders',
      'deactivate Orders',
      'create C',
      'Orders -> C : new',
      'note left of Orders : A waits',
      'note right of Orders : A',
      'note over Orders : A',
      'note over Orders, B : A and B',
      'note over B,Orders : B and A',
      'note left of Orders',
      'A -> B : in the note',
      'end note',
      'note over Orders, B',
      'A -> B : in the note',
      'end note',
      'ref over Orders, B : A and B',
      'ref over B, Orders',
      'A -> B : in the reference',
      'end ref',
      'alt A is open',
      'Orders -> B : one',
      'else A is closed',
      'Orders -> B : two',
      'end',
      'destroy Orders'
    );
    expect(renamed(before, 'Orders')).toBe(after);
  });

  it('changes a name twice on one line, and keeps the label', () => {
    const found = target(doc('participant "Orders desk" as §A', 'A -> A : A'));
    expect(found.places).toEqual([
      { line: FIRST, start: 29, end: 30 },
      { line: FIRST + 1, start: 0, end: 1 },
      { line: FIRST + 1, start: 5, end: 6 },
    ]);
    expect(renamed(doc('participant "Orders desk" as §A', 'A -> A : A'), 'Orders')).toBe(
      doc('participant "Orders desk" as Orders', 'Orders -> Orders : A')
    );
  });

  it('gives an empty rename for the same name', () => {
    const found = target(doc(...BASE));
    expect(newNameRefusal(found, 'A')).toBeNull();
  });
});

describe('what the rename leaves alone', () => {
  it('keeps the name in comments, titles, texts and other lines, and in another diagram', () => {
    const lines = (alias: string): string[] => [
      '# Orders',
      '',
      '```plantuml',
      '@startuml',
      'title A and B',
      "' A -> B : a comment",
      "/'",
      'A -> B : in a block comment',
      'A -> B : still in it',
      "and its end '/",
      "/' A -> B '/",
      `participant "A" as ${alias}`,
      `${alias} -> B : A`,
      '== A ==',
      '...A...',
      `alt A`,
      `${alias} -> B : A`,
      'end',
      `note left of ${alias}`,
      'A',
      'end note',
      'activate B',
      'return A',
      'autonumber inc A',
      '@enduml',
      '```',
      '',
      'A is the orders desk.',
      '',
      '```plantuml',
      '@startuml',
      'participant "A" as A',
      'A -> B : A',
      '@enduml',
      '```',
      '',
    ];
    const before = once(lines('§A').join('\n'));
    expect(renamed(before, 'Orders')).toBe(lines('Orders').join('\n'));
  });
});

describe('names that are not renamed', () => {
  it('refuses a participant that is not declared', () => {
    expect(refusal(doc(...BASE.map((line) => line.replace(CURSOR, '')), 'B -> §C : ask'))).toEqual({
      reason: 'undeclared',
      name: 'C',
    });
  });

  it('refuses a participant declared without as', () => {
    expect(refusal(doc('participant §A', 'A -> B : order'))).toEqual({ reason: 'without-as', name: 'A' });
    expect(refusal(doc('participant §A order 10', 'A -> B : order'))).toEqual({ reason: 'without-as', name: 'A' });
  });

  it('refuses an alias declared twice', () => {
    expect(refusal(doc(...BASE, 'participant "Other" as A'))).toEqual({ reason: 'declared-twice', name: 'A' });
    expect(refusal(doc(...BASE, 'actor A'))).toEqual({ reason: 'declared-twice', name: 'A' });
  });

  it('refuses an alias of other characters than ASCII letters, digits and _, or too long', () => {
    expect(refusal(doc('participant "Orders desk" as §注文', '注文 -> B : order'))).toEqual({
      reason: 'not-ascii',
      name: '注文',
    });
    expect(refusal(doc('participant "Orders desk" as §A.b', 'A.b -> B : order'))).toEqual({
      reason: 'not-ascii',
      name: 'A.b',
    });
    const long = 'a'.repeat(RENAME_LIMITS.nameLength + 1);
    expect(refusal(doc(`participant "Orders desk" as §${long}`, `${long} -> B : order`))).toEqual({
      reason: 'not-ascii',
      name: long,
    });
    const longest = 'a'.repeat(RENAME_LIMITS.nameLength);
    expect(target(doc(`participant "Orders desk" as §${longest}`, `${longest} -> B : order`)).alias).toBe(longest);
  });

  it('finds nothing to rename in another kind of diagram', () => {
    expect(at(doc('class §Order {', '  total()', '}'))).toBeNull();
    expect(at(doc('class Order {', '  §total()', '}'))).toBeNull();
  });

  it('finds nothing to rename in a procedure, a variable or an argument', () => {
    const lines = ['!procedure $ask($to)', 'A -> $to : ask', '!endprocedure', '!$who = "B"', 'participant "Orders desk" as A'];
    expect(at(doc('!procedure $§ask($to)', ...lines.slice(1)))).toBeNull();
    expect(at(doc('!procedure $ask($§to)', ...lines.slice(1)))).toBeNull();
    expect(at(doc(...lines.slice(0, 3), '!$§who = "B"', ...lines.slice(4)))).toBeNull();
    expect(at(doc(...lines.slice(0, 3), '$ask(§who="B")', ...lines.slice(3)))).toBeNull();
  });

  it('refuses rather than changing a participant name a preprocessor line also holds', () => {
    expect(refusal(doc('participant "Orders desk" as A', '!$§A = "B"', 'A -> B : order'))).toEqual({
      reason: 'preprocessor',
      line: FIRST + 1,
    });
  });
});

describe('the new name', () => {
  const found = (): RenameTarget => target(doc(...BASE, 'note over C : waits'));

  it('takes a name of ASCII letters, digits and _, not starting with a digit, of up to 128 characters', () => {
    for (const name of ['Orders', 'orders_2', '_A', 'b', 'a'.repeat(RENAME_LIMITS.nameLength)]) {
      expect(newNameRefusal(found(), name), name).toBeNull();
    }
  });

  it.each(['', '1a', 'a-b', 'a b', ' A', 'A.b', 'A@b', 'Ä', '注文', '"A"'])('refuses %j as not a name', (name) => {
    expect(newNameRefusal(found(), name)).toEqual({ reason: 'invalid', name });
  });

  it('refuses a name longer than 128 characters', () => {
    const name = 'a'.repeat(RENAME_LIMITS.nameLength + 1);
    expect(newNameRefusal(found(), name)).toEqual({ reason: 'too-long', name });
  });

  it.each([
    ...['participant', 'actor', 'boundary', 'control', 'entity', 'database', 'collections', 'queue'],
    ...['as', 'activate', 'deactivate', 'create', 'destroy', 'note', 'ref', 'left', 'right', 'of', 'over', 'order'],
    ...['alt', 'opt', 'loop', 'par', 'group', 'critical', 'break', 'else', 'end'],
    ...['title', 'autonumber', 'hide', 'show', 'skinparam'],
    ...['mainframe', 'caption', 'legend', 'footer', 'header', 'skinparamlocked', 'skin', 'minwidth', 'page'],
    ...['rotate', 'sprite', 'scale', 'leftfooter', 'rightfooter', 'centerfooter', 'leftheader', 'rightheader'],
    'centerheader',
  ])('refuses the keyword %s, in any case', (word) => {
    for (const name of [word, word.toUpperCase(), word[0]?.toUpperCase() + word.slice(1)]) {
      expect(newNameRefusal(found(), name), name).toEqual({ reason: 'reserved', name });
    }
  });

  it('refuses the name of another participant, declared or not', () => {
    expect(newNameRefusal(found(), 'B')).toEqual({ reason: 'taken', name: 'B' });
    expect(newNameRefusal(found(), 'C')).toEqual({ reason: 'taken', name: 'C' });
  });

  it('takes the name of another participant in another case, which the engine keeps apart', () => {
    expect(newNameRefusal(found(), 'c')).toBeNull();
  });
});

describe('diagrams that are not renamed in', () => {
  it('renames in the diagram the refusals are tried on, without the lines they add', () => {
    expect(target(doc(...BASE)).alias).toBe('A');
  });

  it.each<[string, string[], RenameRefusal['reason'], number | undefined]>([
    ['an include', ['!include common.puml'], 'preprocessor', 0],
    ['a variable', ['!$who = "B"'], 'preprocessor', 0],
    ['a condition', ['!if %true()', 'A -> B : x', '!endif'], 'preprocessor', 0],
    ['a procedure', ['!procedure $ask($to)', 'A -> $to : ask', '!endprocedure'], 'preprocessor', 0],
    ['a call of a procedure', ['$ask(B)'], 'preprocessor', 0],
    ['a built-in function in a label', ['A -> B : %date()'], 'preprocessor', 0],
    ['an embedded diagram', ['note left of A', '{{', 'A -> B', '}}', 'end note'], 'line', 1],
    ['a box', ['box "Shop"', 'participant C', 'end box'], 'line', 0],
    ['a skinparam with braces', ['skinparam sequence {', 'ArrowColor red', '}'], 'line', 0],
    ['hide', ['hide footbox'], 'line', 0],
    ['a title over several lines', ['title', 'Orders', 'end title'], 'line', 0],
    ['a legend', ['legend', 'A is the desk', 'end legend'], 'line', 0],
    ['a new page', ['newpage'], 'line', 0],
    ['a note on an arrow', ['note left : n'], 'line', 0],
    ['a note with a colour', ['note left of A #pink : n'], 'line', 0],
    ['an hnote', ['hnote over A : n'], 'line', 0],
    ['a note across', ['/ note over A : n'], 'line', 0],
    ['a message in parallel', ['& A -> B : x'], 'line', 0],
    ['a stereotype', ['participant C <<Service>>'], 'line', 0],
    ['a colour on a declaration', ['participant C #pink'], 'line', 0],
    ['create participant', ['create participant "Shop" as C'], 'line', 0],
    ['a declaration over several lines', ['participant C [', '=Shop', ']'], 'line', 0],
    ['an activation after a name', ['A ++'], 'line', 0],
    ['a line ending with a backslash', ['A -> B : one \\', 'two'], 'line', 0],
    ['a block comment after code', ["A -> B : x /' c '/"], 'line', 0],
    ['code after a block comment', ["/' c '/ A -> B : x"], 'line', 0],
    ['triple quotes', ['A -> B : x """ y'], 'line', 0],
    ['a control character', [`A -> B : x${String.fromCharCode(1)}`], 'line', 0],
    ['a line too long', [`A -> B : ${'x'.repeat(RENAME_LIMITS.lineLength - 8)}`], 'line', 0],
    ['else out of a group', ['else'], 'line', 0],
    ['end out of a group', ['end'], 'line', 0],
    ['end box after a group', ['alt one', 'A -> B : x', 'end box'], 'line', 2],
    ['end  box after a group', ['alt one', 'A -> B : x', 'end  box'], 'line', 2],
    ['par2', ['par2', 'A -> B : x', 'end'], 'line', 0],
    ['also', ['par', 'A -> B : x', 'also', 'B -> A : y', 'end'], 'line', 2],
    ['partition', ['partition Shop', 'A -> B : x', 'end'], 'line', 0],
    ['return ++, an activation of a participant named return', ['return ++'], 'line', 0],
    ['a group left open', ['alt one', 'A -> B : x'], 'open', 0],
    ['a note left open', ['note left of A', 'n'], 'open', 0],
    ['a reference left open', ['ref over A, B', 'r'], 'open', 0],
    ['a style left open', ['<style>', 'participant { FontColor red }'], 'open', 0],
    ['a second diagram', ['@enduml', '@startuml', 'A -> B : x'], 'bounds', undefined],
  ])('refuses the whole diagram with %s in it', (_name, lines, reason, line) => {
    const refused = refusal(doc(...BASE, ...lines));
    expect(refused.reason).toBe(reason);
    expect('line' in refused ? refused.line : undefined).toBe(line === undefined ? undefined : FIRST + BASE.length + line);
  });

  it.each(['->', '-->', '<-', '<--', '->>', '-->>', '<<-', '<<--'])('renames the ends of %s', (arrow) => {
    expect(
      renamed(doc('participant "Orders desk" as §A', `A ${arrow} B : x`, `B${arrow}A:y`, `A  ${arrow}  A`), 'Orders')
    ).toBe(doc('participant "Orders desk" as Orders', `Orders ${arrow} B : x`, `B${arrow}Orders:y`, `Orders  ${arrow}  Orders`));
  });

  it.each([
    'A ->x B : x',
    'A ->o B : x',
    'A o-> B : x',
    'A x-> B : x',
    'A <-> B : x',
    'A ---> B : x',
    'A -[#red]> B : x',
    'A -[dotted]-> B : x',
    'A -\\ B : x',
    'A -/ B : x',
    'A ->(10) B : x',
    'A -> B ++ : x',
    'A -> B -- : x',
    'A -> B & C : x',
    'A -> "Orders desk" : x',
    'A as "Orders" -> B : x',
    '[-> A : x',
    '?-> A : x',
    'A ->] : x',
    'A ->? : x',
    'A ->',
    'A --',
  ])('refuses the whole diagram with the arrow %s', (line) => {
    expect(refusal(doc(...BASE, line))).toEqual({ reason: 'line', line: FIRST + BASE.length });
  });

  it('renames with lines that name no participant around, leaving them as they are', () => {
    const lines = (alias: string): string[] => [
      'autonumber',
      'autonumber 10 10 "<b>[000]"',
      'title A and B',
      'title: A',
      `participant "Orders desk" as ${alias}`,
      '== A ==',
      `${alias} -> B : order`,
      '...',
      '...A waits...',
      '…',
      '|||',
      '||45||',
      'skinparam sequenceMessageAlign center',
      'skinparam participant<<Desk>> BackgroundColor #EEEEEE',
      '<style>',
      'participant {',
      '  FontColor red',
      '}',
      '</style>',
      '<style>participant { FontColor red }</style>',
      'activate B',
      'return A done',
      'activate B',
      'return',
      'autonumber stop',
      'autonumber resume',
      'autonumber resume 10 "<b>(00)"',
      'autonumber inc A',
      'autonumber 1.1.1',
      '',
      "' A comment",
      `${alias} -> B : again`,
    ];
    expect(renamed(once(doc(...lines('§A'))), 'Orders')).toBe(doc(...lines('Orders')));
  });
});

describe('lines as the engine reads them', () => {
  it('reads a title that looks like a message as a title', () => {
    expect(renamed(doc(...BASE, 'title A -> B : order'), 'Orders')).toBe(
      doc('participant "Orders desk" as Orders', 'Orders -> B : order', 'title A -> B : order')
    );
  });

  it('refuses a return whose text starts like a message, which the engine takes for one from return', () => {
    expect(refusal(doc(...BASE, 'activate B', 'return x-> A'))).toEqual({ reason: 'line', line: FIRST + 3 });
  });

  it('reads a note glued to its side as a note', () => {
    expect(renamed(doc(...BASE, 'noteleft of A : n', 'NOTE  OVER A : n'), 'Orders')).toBe(
      doc('participant "Orders desk" as Orders', 'Orders -> B : order', 'noteleft of Orders : n', 'NOTE  OVER Orders : n')
    );
  });

  it('refuses an order glued to a name, which the engine reads as the name and the order', () => {
    expect(refusal(doc(...BASE, 'participant Border 10'))).toEqual({ reason: 'line', line: FIRST + 2 });
  });

  it('reads create participant as the engine does, as the creation of a participant named participant', () => {
    const lines = ['create participant', 'B -> participant : new'];
    expect(renamed(doc(...BASE, ...lines), 'Orders')).toBe(
      doc('participant "Orders desk" as Orders', 'Orders -> B : order', ...lines)
    );
    expect(refusal(doc(...BASE.map((line) => line.replace(CURSOR, '')), 'create §participant'))).toEqual({
      reason: 'undeclared',
      name: 'participant',
    });
  });

  it('refuses a footer or a header with its place glued to it, which the engine reads before a message', () => {
    for (const line of ['centerfooter -> A : x', 'LeftHeader: A', 'rightfooter A']) {
      expect(refusal(doc(...BASE, line)), line).toEqual({ reason: 'line', line: FIRST + 2 });
    }
  });

  it('refuses a group whose text starts like an arrow, which is read as one here', () => {
    expect(refusal(doc(...BASE, 'loop o-ring check', 'A -> B : x', 'end'))).toEqual({ reason: 'line', line: FIRST + 2 });
  });

  it('keeps apart names that differ in case or by a dot or an at sign', () => {
    const lines = (alias: string): string[] => [
      `participant "Orders desk" as ${alias}`,
      `${alias} -> B : order`,
      'a -> B : x',
      'A. -> B : x',
      'A@ -> B : x',
      'AB -> B : x',
    ];
    expect(renamed(once(doc(...lines('§A'))), 'Orders')).toBe(doc(...lines('Orders')));
  });

  it('keeps the text of a note up to end note with no more than one space in it', () => {
    const lines = (alias: string): string[] => [
      `participant "Orders desk" as ${alias}`,
      `note left of ${alias}`,
      'end  note',
      'A -> B : in the note',
      'end note',
      `${alias} -> B : after`,
    ];
    expect(renamed(once(doc(...lines('§A'))), 'Orders')).toBe(doc(...lines('Orders')));
  });

  it('ends a note at end note with a no-break space in it', () => {
    const lines = (alias: string): string[] => [
      `participant "Orders desk" as ${alias}`,
      `note left of ${alias}`,
      'text',
      `end${NBSP}note`,
      `${alias} -> B : after`,
    ];
    expect(renamed(once(doc(...lines('§A'))), 'Orders')).toBe(doc(...lines('Orders')));
  });

  it('takes comments out of the text of a note, as the engine does', () => {
    const lines = (alias: string): string[] => [
      `participant "Orders desk" as ${alias}`,
      `note left of ${alias}`,
      "/'",
      'end note',
      "'/",
      "' end note",
      'A -> B : in the note',
      'end note',
      `${alias} -> B : after`,
    ];
    expect(renamed(once(doc(...lines('§A'))), 'Orders')).toBe(doc(...lines('Orders')));
  });

  it('reads the text of a note in a group up to end note, even where it says end', () => {
    const lines = (alias: string): string[] => [
      `participant "Orders desk" as ${alias}`,
      'alt one',
      `note over ${alias}`,
      'end',
      'end note',
      `${alias} -> B : x`,
      'end',
    ];
    expect(renamed(once(doc(...lines('§A'))), 'Orders')).toBe(doc(...lines('Orders')));
  });

  it('reads the groups with their colours and the words after end', () => {
    const lines = (alias: string): string[] => [
      `participant "Orders desk" as ${alias}`,
      'alt#Gold #LightBlue one',
      `${alias} -> B : x`,
      'else #Pink two',
      `${alias} -> B : y`,
      'end alt',
      'loop',
      'opt',
      'par',
      'break',
      'critical',
      'group Shop',
      `${alias} -> B : z`,
      'end',
      'end',
      'end',
      'end',
      'end',
      'end',
    ];
    expect(renamed(once(doc(...lines('§A'))), 'Orders')).toBe(doc(...lines('Orders')));
  });

  it('refuses else with a colour glued to it, which the engine does not read', () => {
    expect(refusal(doc(...BASE, 'alt one', 'A -> B : x', 'else#Pink two', 'end'))).toEqual({
      reason: 'line',
      line: FIRST + 4,
    });
  });

  it('closes a reference over several lines with end, end ref or endref', () => {
    for (const end of ['end', 'end ref', 'endref', 'END REF']) {
      const lines = (alias: string): string[] => [
        `participant "Orders desk" as ${alias}`,
        `ref over ${alias}, B`,
        'A -> B : in the reference',
        end,
        `${alias} -> B : after`,
      ];
      expect(renamed(once(doc(...lines('§A'))), 'Orders'), end).toBe(doc(...lines('Orders')));
    }
  });

  it('closes a style with an indented end, or with <style>', () => {
    for (const end of ['  </style>  ', '<style>']) {
      const lines = (alias: string): string[] => [
        '<style>',
        'participant {',
        '}',
        end,
        `participant "Orders desk" as ${alias}`,
        `${alias} -> B : x`,
      ];
      expect(renamed(once(doc(...lines('§A'))), 'Orders'), end).toBe(doc(...lines('Orders')));
    }
  });

  it('reads the keywords in any case', () => {
    const lines = (alias: string): string[] => [
      `PARTICIPANT "Orders desk" AS ${alias}`,
      `ACTIVATE ${alias}`,
      `NOTE LEFT OF ${alias} : n`,
      `Ref Over ${alias}, B : r`,
      'ALT one',
      `${alias} -> B : x`,
      'ELSE two',
      'END',
      'AUTONUMBER',
      'Return',
    ];
    expect(renamed(once(doc(...lines('§A'))), 'Orders')).toBe(doc(...lines('Orders')));
  });

  it('reads lines indented with spaces, tabs and no-break spaces, and with spaces after them', () => {
    const lines = (alias: string): string[] => [
      `  participant "Orders desk" as ${alias}  `,
      `\t${alias} -> B : x\t`,
      `${NBSP}${alias} -> B : y${NBSP}`,
      `  alt one`,
      `    ${alias} -> B : z`,
      '  end',
    ];
    expect(renamed(once(doc(...lines('§A'))), 'Orders')).toBe(doc(...lines('Orders')));
  });

  it('reads a start line with an id and indented start and end lines', () => {
    const block = (start: string, end: string, alias: string): string =>
      ['```plantuml', start, `participant "Orders desk" as ${alias}`, `${alias} -> B : x`, end, '```', ''].join('\n');
    expect(renamed(once(block('@startuml(id=orders)', '@enduml', '§A')), 'Orders')).toBe(block('@startuml(id=orders)', '@enduml', 'Orders'));
    expect(renamed(once(block('  @startuml', ' @enduml ', '§A')), 'Orders')).toBe(block('  @startuml', ' @enduml ', 'Orders'));
  });
});

describe('the block', () => {
  const block = (...lines: string[]): string => ['```plantuml', ...lines, '```', ''].join('\n');

  it('refuses a block without a closing fence', () => {
    expect(refusal(['```plantuml', '@startuml', ...BASE, '@enduml'].join('\n'))).toEqual({ reason: 'unclosed' });
  });

  it('refuses a block that does not hold one diagram from @startuml to @enduml', () => {
    expect(refusal(block(...BASE))).toEqual({ reason: 'bounds' });
    expect(refusal(block('@startuml', ...BASE))).toEqual({ reason: 'bounds' });
    expect(refusal(block('Orders', '@startuml', ...BASE, '@enduml'))).toEqual({ reason: 'bounds' });
    expect(refusal(block('@startuml', ...BASE, '@enduml', 'Orders'))).toEqual({ reason: 'bounds' });
    expect(refusal(block("' first", '@startuml', ...BASE, '@enduml'))).toEqual({ reason: 'bounds' });
    expect(refusal(block('@startmindmap', ...BASE, '@endmindmap'))).toEqual({ reason: 'bounds' });
    expect(refusal(block('@startuml', ...BASE, '\\enduml', '@enduml'))).toEqual({ reason: 'bounds' });
  });

  it('renames in a block with blank lines around the diagram', () => {
    const lines = (alias: string): string => block('', '@startuml', `participant "Orders desk" as ${alias}`, `${alias} -> B : x`, '@enduml', '');
    expect(renamed(once(lines('§A')), 'Orders')).toBe(lines('Orders'));
  });
});

describe('the places in the document', () => {
  it('renames in a block quote', () => {
    const lines = (alias: string): string =>
      [
        '> ```plantuml',
        '> @startuml',
        `> participant "Orders desk" as ${alias}`,
        `>  ${alias} -> B : x`,
        '>',
        '> @enduml',
        '> ```',
        '',
      ].join('\n');
    expect(renamed(once(lines('§A')), 'Orders')).toBe(lines('Orders'));
  });

  it('refuses a line it cannot match to what the diagram is given', () => {
    // A tab after the quote marker: the block's line is not the line of the
    // diagram once the marker is taken off as the block's other lines are.
    const text = ['> ```plantuml', '> @startuml', '> participant "Orders desk" as §A', '>\tA -> B : x', '> @enduml', '> ```', ''].join('\n');
    expect(refusal(text)).toEqual({ reason: 'mapping' });
  });

  it('renames in a block in a list in a list', () => {
    const nested = (alias: string): string =>
      [
        '- one',
        '  - two',
        '',
        '    ```plantuml',
        '    @startuml',
        `    participant "Orders desk" as ${alias}`,
        `    ${alias} -> B : x`,
        '    @enduml',
        '    ```',
        '',
      ].join('\n');
    expect(renamed(once(nested('§A')), 'Orders')).toBe(nested('Orders'));
    const onTheItem = (alias: string): string =>
      [
        '1. one',
        '   - ```plantuml',
        '     @startuml',
        `     participant "Orders desk" as ${alias}`,
        `     ${alias} -> B : x`,
        '     @enduml',
        '     ```',
        '',
      ].join('\n');
    expect(renamed(once(onTheItem('§A')), 'Orders')).toBe(onTheItem('Orders'));
  });

  it('counts the columns in UTF-16 code units, past characters outside the BMP', () => {
    const text = doc('participant "😀😀" as §A', 'A -> B : 😀 A', 'note over B, A : 😀 A');
    const found = target(text);
    expect(found.places).toEqual([
      { line: FIRST, start: 22, end: 23 },
      { line: FIRST + 1, start: 0, end: 1 },
      { line: FIRST + 2, start: 13, end: 14 },
    ]);
    expect(renamed(text, 'Orders')).toBe(
      doc('participant "😀😀" as Orders', 'Orders -> B : 😀 A', 'note over B, Orders : 😀 A')
    );
    // A line that starts with one is not a message: an emoji is not a letter of a name.
    expect(refusal(doc('participant "😀😀" as §A', '😀 -> A : x'))).toEqual({ reason: 'line', line: FIRST + 1 });
  });

  it('renames in a document with CRLF line ends', () => {
    const crlf = (alias: string): string => doc(`participant "Orders desk" as ${alias}`, `${alias} -> B : x`).replace(/\n/g, '\r\n');
    const found = target(once(crlf('§A')));
    expect(found.places).toEqual([
      { line: FIRST, start: 29, end: 30 },
      { line: FIRST + 1, start: 0, end: 1 },
    ]);
  });

  it('renames in the block the cursor is in, and not in another', () => {
    const two = (alias: string): string =>
      [doc(`participant "Orders desk" as ${alias}`, `${alias} -> B : x`), doc('participant "Orders desk" as A', 'A -> B : x')].join('\n');
    expect(renamed(once(two('§A')), 'Orders')).toBe(two('Orders'));
  });
});

describe('the limits', () => {
  it(`renames ${RENAME_LIMITS.places} places, and refuses one more`, () => {
    const messages = (count: number): string[] => Array.from({ length: count }, (_, index) => `A -> B : ${index}`);
    expect(target(doc('participant "Orders desk" as §A', ...messages(RENAME_LIMITS.places - 1))).places).toHaveLength(
      RENAME_LIMITS.places
    );
    expect(refusal(doc('participant "Orders desk" as §A', ...messages(RENAME_LIMITS.places)))).toEqual({
      reason: 'too-many',
      name: 'A',
    });
  });

  it(`reads lines of up to ${RENAME_LIMITS.lineLength} characters`, () => {
    const line = `A -> B : ${'x'.repeat(RENAME_LIMITS.lineLength - 9)}`;
    expect(line).toHaveLength(RENAME_LIMITS.lineLength);
    expect(target(doc(...BASE, line)).places).toHaveLength(3);
  });
});

describe('where the cursor is', () => {
  it.each([
    ['a heading', ['# §Orders', '', '```plantuml', '@startuml', ...BASE.map((line) => line.replace(CURSOR, '')), '@enduml', '```']],
    ['a paragraph', ['§A is the orders desk.', '', '```plantuml', '@startuml', 'participant "Orders desk" as A', '@enduml', '```']],
    ['the opening fence', ['```§plantuml', '@startuml', 'participant "Orders desk" as A', '@enduml', '```']],
    ['the closing fence', ['```plantuml', '@startuml', 'participant "Orders desk" as A', '@enduml', '§```']],
    ['a block of another language', ['```text', '@startuml', 'participant "Orders desk" as §A', '@enduml', '```']],
  ])('finds nothing on %s', (_name, lines) => {
    expect(at(lines.join('\n'))).toBeNull();
  });

  it.each([
    ['a keyword', ['§participant "Orders desk" as A', 'A -> B : order']],
    ['the name shown', ['participant "§Orders desk" as A', 'A -> B : order']],
    ['a label', ['participant "Orders desk" as A', 'A -> B : §order']],
    ['the start line', ['participant "Orders desk" as A', 'A -> B : order']],
    ['the text of a note', ['participant "Orders desk" as A', 'note left of A', '§A', 'end note']],
    ['a comment', ['participant "Orders desk" as A', "' §A -> B"]],
    ['a word of a line not read', ['participant "Orders desk" as A', '§box "Shop"', 'end box']],
  ])('finds nothing on %s in the block', (name, lines) => {
    const text = name === 'the start line' ? doc(...lines).replace('@startuml', '@start§uml') : doc(...lines);
    expect(at(text)).toBeNull();
  });

  it('refuses on a participant name on a line not read, with the reason', () => {
    expect(refusal(doc(...BASE.map((line) => line.replace(CURSOR, '')), 'A -[#red]> §B : x'))).toEqual({
      reason: 'line',
      line: FIRST + 2,
    });
  });

  it('refuses on a participant name in a block without a closing fence', () => {
    expect(refusal(['```plantuml', '@startuml', ...BASE, ''].join('\n'))).toEqual({ reason: 'unclosed' });
  });
});

describe('the text as it is when asked again', () => {
  it('reads the places again from the text given', () => {
    const before = placed(doc(...BASE));
    expect(renameAt(before.text, before.line, before.character)).toMatchObject({ places: { length: 2 } });
    const after = before.text.replace('A -> B : order', 'A -> B : order\nB -> A : done');
    expect(renameAt(after, before.line, before.character)).toMatchObject({ places: { length: 3 } });
    const unclosed = after.replace(/```\n$/, '');
    expect(renameAt(unclosed, before.line, before.character)).toEqual({ refused: { reason: 'unclosed' } });
  });
});
