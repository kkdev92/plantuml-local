import { describe, expect, it } from 'vitest';

import { callAt, callNamedAt, writtenArguments, type Reading } from '../../src/language/calls';

const NO_BREAK_SPACE = String.fromCharCode(0xa0);
const TAB = '\t';

/** How the names the tests declare read their arguments. */
const DECLARED = new Map<string, Reading>([
  ['P', 'quoted'],
  ['Q', 'quoted'],
  ['$P', 'quoted'],
  ['$g', 'quoted'],
  ['U', 'unquoted'],
  ['F', 'legacy'],
  ['G', 'legacy'],
]);

/**
 * The call at the `‸` of `marked`: its name, how it reads its arguments,
 * and each argument as written, after its name when it names itself.
 */
function read(marked: string): { name: string; reading: Reading; arguments: string[] } | null {
  const column = marked.indexOf('‸');
  const line = marked.slice(0, column) + marked.slice(column + 1);
  const call = callAt(line, column, (name) => DECLARED.get(name) ?? null);
  if (call === null) {
    return null;
  }
  return {
    name: line.slice(call.start, call.end),
    reading: call.reading,
    arguments: call.arguments.map(
      (argument) => (argument.name === undefined ? '' : `${argument.name}: `) + line.slice(argument.start, argument.end)
    ),
  };
}

const args = (marked: string): string[] | undefined => read(marked)?.arguments;
const name = (marked: string): string | undefined => read(marked)?.name;

describe('callAt in text', () => {
  it('finds the declared name before the cursor and the arguments up to it', () => {
    expect(read('P(a, b‸')).toEqual({ name: 'P', reading: 'quoted', arguments: ['a', ' b'] });
    expect(read('P(‸')).toEqual({ name: 'P', reading: 'quoted', arguments: [''] });
    expect(read('  U(a, ‸ b)')).toEqual({ name: 'U', reading: 'unquoted', arguments: ['a', ' '] });
    expect(read('F(‸')).toEqual({ name: 'F', reading: 'legacy', arguments: [''] });
  });

  it('calls only a name declared before the line, right before its bracket', () => {
    expect(read('R(a, ‸')).toBeNull();
    expect(read('P (a, ‸')).toBeNull();
    expect(read('P‸(a)')).toBeNull();
    expect(read('p(a, ‸')).toBeNull();
  });

  it('does not call a name that goes on from a letter, a digit or `_`, unless it starts with `$`', () => {
    expect(read('xP(a, ‸')).toBeNull();
    expect(read('1P(a, ‸')).toBeNull();
    expect(read('_P(a, ‸')).toBeNull();
    expect(name('x$P(a, ‸')).toBe('$P');
    expect(name('-P(a, ‸')).toBe('P');
    // A written `\n` is a line break, not a letter (VariableManager.justAfterBackslashN).
    expect(name('a\\nP(a, ‸')).toBe('P');
  });

  it('reads a built-in function as an expression, after a letter too', () => {
    expect(read('x%strlen(a, ‸')).toEqual({ name: '%strlen', reading: 'quoted', arguments: ['a', ' '] });
    expect(args('P(%strlen("x, y"), ‸')).toEqual(['%strlen("x, y")', ' ']);
  });

  it('goes on after a call that ends before the cursor', () => {
    expect(read('P(a) ‸')).toBeNull();
    expect(read('P(a) Q(b, ‸')).toEqual({ name: 'Q', reading: 'quoted', arguments: ['b', ' '] });
  });

  it('does not read the text outside a call for quotes', () => {
    expect(args('"P(a, ‸"')).toEqual(['a', ' ']);
    expect(args("it's P(a, ‸")).toEqual(['a', ' ']);
  });

  it('reads a declaration line from after the name it declares', () => {
    expect(read('!procedure P(‸')).toBeNull();
    expect(read('!procedure P($a, $b = Q(1, ‸')).toEqual({ name: 'Q', reading: 'quoted', arguments: ['1', ' '] });
    expect(name('!function $f($a) return $g($a, ‸')).toBe('$g');
    expect(read('!define F(x) G(x, ‸')).toEqual({ name: 'G', reading: 'legacy', arguments: ['x', ' '] });
    expect(read('!definelong F(x‸')).toBeNull();
    // The parameters and the one-line body of a procedure or function are expressions.
    expect(name('!function $f($a) return f (a, ‸')).toBe('f');
    expect(read('!procedure P($a = "Q(1, ‸')).toBeNull();
  });
});

describe('callAt reading arguments as expressions', () => {
  it('does not split at a comma within a string', () => {
    expect(args('P("a, b", ‸')).toEqual(['"a, b"', ' ']);
    expect(args("P('a, b', ‸")).toEqual(["'a, b'", ' ']);
    expect(args('P("a, ‸')).toEqual(['"a, ']);
  });

  it('opens a string only where a word starts', () => {
    // An apostrophe in a word is part of it (TokenType.isPlainTextBreak).
    expect(args("P(don't, ‸")).toEqual(["don't", ' ']);
    expect(args(`P(a${TAB}"b, ‸`)).toEqual([`a${TAB}"b`, ' ']);
    // After a number, an operator, `=` or a space, a word starts.
    expect(args('P(1"a, b", ‸')).toEqual(['1"a, b"', ' ']);
    expect(args('P(a+"b, c", ‸')).toEqual(['a+"b, c"', ' ']);
    expect(args('P(a "b, c", ‸')).toEqual(['a "b, c"', ' ']);
    expect(args(`P(a${NO_BREAK_SPACE}"b, c", ‸`)).toEqual([`a${NO_BREAK_SPACE}"b, c"`, ' ']);
  });

  it('does not split at a comma within round brackets, but does within square and curly ones', () => {
    expect(args('P((a, b), ‸')).toEqual(['(a, b)', ' ']);
    expect(args('P([a, b], ‸')).toEqual(['[a', ' b]', ' ']);
    expect(args('P({a, b}, ‸')).toEqual(['{a', ' b}', ' ']);
  });

  it('calls any word right before a bracket, white space between them or not', () => {
    expect(read('P(f(a, ‸')).toEqual({ name: 'f', reading: 'quoted', arguments: ['a', ' '] });
    expect(name('P(f (a, ‸')).toBe('f');
    expect(name(`P(f${NO_BREAK_SPACE}(a, ‸`)).toBe('f');
    // A declared name read within an expression reads its arguments as expressions.
    expect(read('P(U(a "b, ‸')).toEqual({ name: 'U', reading: 'quoted', arguments: ['a "b, '] });
    expect(args('P(f(a), ‸')).toEqual(['f(a)', ' ']);
  });

  it('does not call a bracket after a number, a string or an operator', () => {
    expect(args('P(1 (a, b), ‸')).toEqual(['1 (a, b)', ' ']);
    expect(args('P("x" (a, ‸')).toEqual(['"x" (a, ']);
    expect(args('P(a + (b, ‸')).toEqual(['a + (b, ']);
  });

  it('names an argument that starts with a name and `=`', () => {
    expect(args('P($b = 1, ‸')).toEqual(['$b: $b = 1', ' ']);
    expect(args('P(a, $c="x, y", ‸')).toEqual(['a', '$c:  $c="x, y"', ' ']);
    expect(args('P(‸$b = 1)')).toEqual(['$b: ']);
    expect(args('P(b = 1, ‸')).toEqual(['b: b = 1', ' ']);
    expect(args('P($b, ‸')).toEqual(['$b', ' ']);
  });
});

describe('callAt reading arguments as text', () => {
  it('opens a string only at the start of an argument, or of a named one’s value', () => {
    expect(args('U("b, c", ‸')).toEqual(['"b, c"', ' ']);
    expect(args('U(a, "b, c", ‸')).toEqual(['a', ' "b, c"', ' ']);
    expect(args('U(a "b, c", ‸')).toEqual(['a "b', ' c"', ' ']);
    expect(args('U($x = "a, b", ‸')).toEqual(['$x: $x = "a, b"', ' ']);
    expect(args('U($x = y "a, b", ‸')).toEqual(['$x: $x = y "a', ' b"', ' ']);
  });

  it('does not name the arguments of a macro', () => {
    expect(args('F($a = 1, ‸')).toEqual(['$a = 1', ' ']);
    expect(args('F("a, b", ‸')).toEqual(['"a, b"', ' ']);
    expect(args('F(a "b, c", ‸')).toEqual(['a "b', ' c"', ' ']);
  });

  it('counts every round bracket outside its own strings, those of the calls within too', () => {
    expect(args('U((a, b), ‸')).toEqual(['(a, b)', ' ']);
    // The `)` within the string of the call ends the argument here (Eater.eatAndGetOptionalQuotedString).
    expect(read('U(P(")", ‸')).toEqual({ name: 'U', reading: 'unquoted', arguments: ['P(")"', ' '] });
    expect(read('U((")"), ‸')).toBeNull();
  });

  it('reads calls in what an argument holds, with their own reading, its string too', () => {
    expect(read('U(P("a, b", ‸')).toEqual({ name: 'P', reading: 'quoted', arguments: ['"a, b"', ' '] });
    expect(read('U("Q(1, ‸')).toEqual({ name: 'Q', reading: 'quoted', arguments: ['1', ' '] });
    expect(read('F(a, U(b, ‸')).toEqual({ name: 'U', reading: 'unquoted', arguments: ['b', ' '] });
    // The calls in a string end with it.
    expect(read('U("Q(1", ‸')).toEqual({ name: 'U', reading: 'unquoted', arguments: ['"Q(1"', ' '] });
    expect(read('U("Q(1"‸')).toEqual({ name: 'U', reading: 'unquoted', arguments: ['"Q(1"'] });
    // A word before a bracket is no call in text.
    expect(read('U(f(a, ‸')).toEqual({ name: 'U', reading: 'unquoted', arguments: ['f(a, '] });
  });
});

describe('callAt on lines that read an expression', () => {
  it('reads the value of an assignment and what `!if`, `!elseif`, `!while` and `!return` read', () => {
    expect(read('!$x = P(a, ‸')).toEqual({ name: 'P', reading: 'quoted', arguments: ['a', ' '] });
    expect(name('!local $x ?= f (a, ‸')).toBe('f');
    expect(name('!if P(a) == f(‸')).toBe('f');
    expect(name('  !elseif P(‸')).toBe('P');
    expect(name('!while P(‸')).toBe('P');
    expect(name('!return P(‸')).toBe('P');
    expect(read('!$x = U(a "b, ‸')).toEqual({ name: 'U', reading: 'quoted', arguments: ['a "b, '] });
  });

  it('reads the strings of the expression', () => {
    expect(read('!$x = "P(a, ‸')).toBeNull();
    expect(name("!$x = don't P(1, ‸")).toBe('P');
    expect(read('!$x = 12"P(1, ‸')).toBeNull();
    expect(name('!$x = a12"P(1, ‸')).toBe('a12"P');
    // `&&` and `||` are one operator: a word starts after them.
    expect(read('!$x = a&&"P(1, ‸')).toBeNull();
    expect(read('!$x = a||"P(1, ‸')).toBeNull();
    expect(name('!$x = a&"P(1, ‸')).toBe('a&"P');
  });

  it('reads no call before the expression, nor in JSON data', () => {
    expect(read('!$x‸ = P(a)')).toBeNull();
    expect(read('!$x = { "a": P(‸')).toBeNull();
    expect(read('!$x = [P(‸')).toBeNull();
    expect(read('!if ‸')).toBeNull();
    expect(read('!$x = P(a), ‸')).toBeNull();
  });

  it('reads `!foreach` from after its `in`', () => {
    expect(name('!foreach $i in P(‸')).toBe('P');
    expect(read('!foreach $i‸ in P(a)')).toBeNull();
    expect(read('!foreach $i in [P(‸')).toBeNull();
  });

  it('reads `!while` as an expression, from a square bracket too', () => {
    expect(name('!while [ P(‸')).toBe('P');
    // A square bracket is part of a word.
    expect(name('!while [P(‸')).toBe('[P');
  });

  it('reads no call on the lines that read a name or end a block', () => {
    for (const line of [
      '!ifdef P(‸',
      '!ifndef P(‸',
      '!undef P(‸',
      '!else P(‸',
      '!endif P(‸',
      '!endwhile P(‸',
      '!endfor P(‸',
      '!endprocedure P(‸',
      '!startsub P(‸',
      '!endsub P(‸',
    ]) {
      expect(read(line), line).toBeNull();
    }
    expect(name('!include P(‸')).toBe('P');
  });
});

describe('callAt and comments', () => {
  it('reads nothing on a comment line', () => {
    expect(read("' P(a, ‸")).toBeNull();
    expect(read("/' P(a, ‸ '/")).toBeNull();
    expect(read("/' P(a, ‸")).toBeNull();
  });

  it('reads a line without the comment it starts or ends with, in the columns of the line', () => {
    expect(read("/' c '/ P(a, b‸")).toEqual({ name: 'P', reading: 'quoted', arguments: ['a', ' b'] });
    expect(read("P(a, /' c '/‸")).toEqual({ name: 'P', reading: 'quoted', arguments: ['a', ' '] });
    expect(args("P(a, ‸/' c '/")).toEqual(['a', ' ']);
    expect(read("P(a, /' c‸ '/")).toBeNull();
    expect(read("/' c ‸'/ P(a, b")).toBeNull();
  });
});

/**
 * The call whose name starts at the `‸` of `marked`, read whole: its name,
 * each argument as written, after its name when it names itself, and how
 * many are given by position and by name.
 */
function whole(marked: string): { name: string; arguments: string[]; count: number; named: string[] } | null {
  const column = marked.indexOf('‸');
  const line = marked.slice(0, column) + marked.slice(column + 1);
  const call = callNamedAt(line, column, (name) => DECLARED.get(name) ?? null);
  if (call === null) {
    return null;
  }
  return {
    name: line.slice(call.start, call.end),
    arguments: call.arguments.map(
      (argument) => (argument.name === undefined ? '' : `${argument.name}: `) + line.slice(argument.start, argument.end)
    ),
    ...writtenArguments(call, line),
  };
}

describe('callNamedAt', () => {
  it('reads every argument of the call whose name starts at the column, up to its bracket', () => {
    expect(whole('‸P(a, b) and more')).toEqual({ name: 'P', arguments: ['a', ' b'], count: 2, named: [] });
    expect(whole('x ‸P(a, "b, c", (d, e)) and more')).toEqual({
      name: 'P',
      arguments: ['a', ' "b, c"', ' (d, e)'],
      count: 3,
      named: [],
    });
    expect(whole('‸U(a "b, c")')).toEqual({ name: 'U', arguments: ['a "b', ' c"'], count: 2, named: [] });
  });

  it('counts no argument for empty brackets, and one for an argument left empty after a comma', () => {
    expect(whole('‸P()')).toEqual({ name: 'P', arguments: [''], count: 0, named: [] });
    expect(whole('‸P( )')).toEqual({ name: 'P', arguments: [' '], count: 0, named: [] });
    expect(whole('‸P(a, )')).toEqual({ name: 'P', arguments: ['a', ' '], count: 2, named: [] });
  });

  it('tells the arguments given by name from those given by position', () => {
    expect(whole('‸P(a, $c = 1, $d="x, y")')).toEqual({
      name: 'P',
      arguments: ['a', '$c:  $c = 1', '$d:  $d="x, y"'],
      count: 1,
      named: ['$c', '$d'],
    });
    // A macro names none.
    expect(whole('‸F($a = 1)')).toEqual({ name: 'F', arguments: ['$a = 1'], count: 1, named: [] });
  });

  it('reads the call within another, and the one around it', () => {
    expect(whole('P(a, ‸Q(b, c), d)')).toEqual({ name: 'Q', arguments: ['b', ' c'], count: 2, named: [] });
    expect(whole('‸P(a, Q(b, c), d)')).toEqual({ name: 'P', arguments: ['a', ' Q(b, c)', ' d'], count: 3, named: [] });
    expect(whole('P(‸f(1, 2))')).toEqual({ name: 'f', arguments: ['1', ' 2'], count: 2, named: [] });
  });

  it('reads up to the end of the line a call that does not end on it', () => {
    expect(whole('‸P(a, b')).toEqual({ name: 'P', arguments: ['a', ' b'], count: 2, named: [] });
    expect(whole('‸P(')).toEqual({ name: 'P', arguments: [''], count: 0, named: [] });
  });

  it('finds no call where none starts, nor of a name not declared, nor in a comment', () => {
    expect(whole('P‸(a)')).toBeNull();
    expect(whole('‸R(a)')).toBeNull();
    expect(whole('x‸P(a)')).toBeNull();
    expect(whole("' ‸P(a)")).toBeNull();
    expect(whole("P(a, /' ‸Q(b) '/ c)")).toBeNull();
  });

  it('reads a call on a line that reads an expression, and not where the line reads none', () => {
    expect(whole('!$x = ‸P(1, 2) + 1')).toEqual({ name: 'P', arguments: ['1', ' 2'], count: 2, named: [] });
    expect(whole('!if ‸$P(1) == 2')).toEqual({ name: '$P', arguments: ['1'], count: 1, named: [] });
    expect(whole('!ifdef ‸P(1)')).toBeNull();
  });
});
