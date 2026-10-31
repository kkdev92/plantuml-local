/**
 * The statements of a `<style>` block, read as the bundled engine reads
 * them (RawStyleParser upstream, at v1.2026.9). A rule is selectors — names
 * separated by commas, maybe a `*` after them — and statements in braces;
 * an `@` rule, such as `@media dark`, is statements in braces; a variable
 * is declared `--name value`; a property is a name and its value, up to a
 * `;`, a closing brace or the end of the line, written `Name value` or
 * `Name: value;`. White space and comments go between them: `//` to the
 * end of the line, and `/*` and `/'` comments up to their ends. A comment
 * after a value is part of the value, which the engine then cannot read.
 * A name is a selector when a comma, a `*` or a brace follows it, white
 * space and line breaks between, and a property otherwise.
 *
 * Like the rest of src/core, this has no dependency on the `vscode` module.
 * Lines and columns are counted from 0.
 */

/** A property as written: its name, and its value without the spaces around it, both on the line of the name. */
export interface StyleProperty {
  name: string;
  line: number;
  start: number;
  end: number;
  /** Where the value is written: empty, at the end of what precedes it, when there is none. */
  value: { line: number; start: number; end: number; text: string };
}

/** A rule open where the reading stops: its selectors as written, `*` after them, or an `@` rule. */
export interface OpenRule {
  selectors: readonly string[];
  star: boolean;
  at: boolean;
}

/** What the place where the reading stops lies in. */
export type StylePending =
  /** Between statements, where a name can start. */
  | { kind: 'statement' }
  /** In a name, which starts at `start` of `line`: a property's or a selector's, as what follows tells. */
  | { kind: 'name'; line: number; start: number }
  /** In the value of property `name`, on the line of the stop, which starts at `start`, or would. */
  | { kind: 'value'; name: string; start: number }
  /** In a comment, quoted text, a list of selectors, the head of an `@` rule or a variable, or after a line break that follows a name. */
  | { kind: 'other' };

/** What {@link readStyleSheet} reads. */
export interface StyleSheet {
  /** The properties, in order. */
  properties: StyleProperty[];
  /** The rules open where the reading stops, outermost first. */
  open: OpenRule[];
  /** Whether the engine refuses a statement before the place the reading stops: the style is then an error. */
  refused: boolean;
  /** What that place lies in; `other` when the reading does not stop before the end. */
  pending: StylePending;
}

const END = '';

/**
 * Reads `lines`, the lines of a style sheet, up to `stop` (the place of a
 * cursor), or to their end. Past a statement the engine refuses, it reads
 * on from the next line, so that the properties after it are still found.
 */
export function readStyleSheet(lines: readonly string[], stop?: { line: number; column: number }): StyleSheet {
  const text = lines.join('\n');
  const starts: number[] = [];
  let length = 0;
  for (const line of lines) {
    starts.push(length);
    length += line.length + 1;
  }
  const limit = stop === undefined ? text.length : Math.min(text.length, (starts[stop.line] ?? text.length) + stop.column);
  const lineOf = (offset: number): number => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if ((starts[middle] ?? 0) <= offset) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return low;
  };
  const columnOf = (offset: number): number => offset - (starts[lineOf(offset)] ?? 0);

  let at = 0;
  const peek = (ahead = 0): string => (at + ahead < limit ? text.charAt(at + ahead) : END);
  const stopped = (): boolean => stop !== undefined && at >= limit;
  const sheet: StyleSheet = { properties: [], open: [], refused: false, pending: { kind: 'other' } };

  /** Skips white space and comments: false when the stop falls in a comment. */
  const skipSpace = (): boolean => {
    for (;;) {
      const char = peek();
      if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
        at += 1;
      } else if (char === '/' && peek(1) === '/') {
        while (peek() !== END && peek() !== '\n') {
          at += 1;
        }
        if (stopped()) {
          return false;
        }
      } else if (char === '/' && (peek(1) === '*' || peek(1) === "'")) {
        const close = peek(1);
        at += 2;
        while (peek() !== END && !(peek() === close && peek(1) === '/')) {
          at += 1;
        }
        if (peek() === END) {
          return !stopped();
        }
        at += 2;
      } else {
        return true;
      }
    }
  };

  const delimiter = (char: string): boolean => char === END || ' \t\n\r{};,:*'.includes(char);

  /** A name, or quoted text; null when the stop falls in it. */
  const readName = (): string | null => {
    if (peek() === '"') {
      at += 1;
      const from = at;
      while (peek() !== END && peek() !== '"') {
        at += 1;
      }
      if (peek() === END && stopped()) {
        return null;
      }
      const name = text.slice(from, at);
      at += peek() === '"' ? 1 : 0;
      return name;
    }
    // A stereotype, after a dot, may hold spaces.
    const stereotype = peek() === '.';
    const from = at;
    while (!delimiter(peek()) || (stereotype && peek() === ' ')) {
      at += 1;
    }
    return stopped() ? null : text.slice(from, at).trim();
  };

  /** A value, from where `at` is: its place, or null when the stop falls in it. */
  const readValue = (): { start: number; end: number } | null => {
    while (peek() === ' ' || peek() === '\t') {
      at += 1;
    }
    while (peek() === ':') {
      at += 1;
    }
    while (peek() === ' ' || peek() === '\t') {
      at += 1;
    }
    const start = at;
    let end = at;
    for (;;) {
      const char = peek();
      if (char === END || char === '\n' || char === '\r' || char === '}') {
        break;
      }
      if (char === ';') {
        at += 1;
        break;
      }
      at += 1;
      if (char === '"') {
        while (peek() !== END && peek() !== '"') {
          at += 1;
        }
        if (peek() === END) {
          return stopped() ? null : { start, end: at };
        }
        at += 1;
      }
      if (char !== ' ' && char !== '\t') {
        end = at;
      }
    }
    return stopped() ? null : { start, end };
  };

  /** Refuses the statement at `at`: the engine stops there; the reading goes on from the next line. */
  const refuse = (): void => {
    sheet.refused = true;
    while (peek() !== END && peek() !== '\n') {
      at += 1;
    }
  };

  /** The selectors after the first, a `*` and the brace that opens the rule, then the rule open; false when the stop falls in them. */
  const openRule = (first: string): boolean => {
    const selectors = [first];
    if (!skipSpace()) {
      return false;
    }
    while (peek() === ',') {
      at += 1;
      const name = skipSpace() ? readName() : null;
      if (name === null || !skipSpace()) {
        return false;
      }
      selectors.push(name);
    }
    const star = peek() === '*';
    if (star) {
      at += 1;
      if (!skipSpace()) {
        return false;
      }
    }
    if (peek() !== '{') {
      if (stopped()) {
        return false;
      }
      refuse();
      return true;
    }
    at += 1;
    sheet.open.push({ selectors, star, at: false });
    return true;
  };

  /** The statement at `at`, which starts with a name; false when the stop falls in it, with what it falls in. */
  const statement = (): boolean => {
    const from = at;
    const quoted = peek() === '"';
    const name = readName();
    if (name === null) {
      sheet.pending = quoted ? { kind: 'other' } : { kind: 'name', line: lineOf(from), start: columnOf(from) };
      return false;
    }
    if (name === '') {
      refuse();
      return true;
    }
    if (name.startsWith('--')) {
      return readValue() !== null;
    }
    const after = at;
    if (!skipSpace()) {
      return false;
    }
    if (stopped()) {
      // A name, then the stop: a property, unless a line break follows the name.
      if (!text.slice(after, at).includes('\n')) {
        sheet.pending = { kind: 'value', name, start: columnOf(at) };
      }
      return false;
    }
    const next = peek();
    if (next === ',' || next === '*' || next === '{') {
      return openRule(name);
    }
    // Outside of any rule the engine refuses a property; it is read all the same.
    if (sheet.open.length === 0) {
      sheet.refused = true;
    }
    const line = lineOf(from);
    const before = at;
    const value = readValue();
    if (value === null) {
      // Only on the line of the name: a value after a line break is read too, but not offered.
      const start = text.slice(before, at).search(/[^ \t:]/);
      if (!text.slice(after, at).includes('\n')) {
        sheet.pending = { kind: 'value', name, start: columnOf(start === -1 ? at : before + start) };
      }
      return false;
    }
    if (lineOf(value.start) === line) {
      sheet.properties.push({
        name,
        line,
        start: columnOf(from),
        end: columnOf(from) + name.length,
        value: { line, start: columnOf(value.start), end: columnOf(value.end), text: text.slice(value.start, value.end) },
      });
    }
    return true;
  };

  for (;;) {
    if (!skipSpace()) {
      return sheet;
    }
    const char = peek();
    if (char === END) {
      if (stopped()) {
        sheet.pending = { kind: 'statement' };
      }
      return sheet;
    }
    if (char === '}') {
      at += 1;
      sheet.open.pop();
    } else if (char === '@') {
      while (peek() !== END && !'{};'.includes(peek())) {
        at += 1;
      }
      if (stopped()) {
        return sheet;
      }
      if (peek() === '{') {
        at += 1;
        sheet.open.push({ selectors: [], star: false, at: true });
      } else {
        refuse();
      }
    } else if (char === ':') {
      at += 1;
      const name = readName();
      if (name === null || !openRule(name)) {
        return sheet;
      }
    } else if (!statement()) {
      return sheet;
    }
  }
}
