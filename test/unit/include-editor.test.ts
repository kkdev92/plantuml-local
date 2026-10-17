import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import type * as vscode from 'vscode';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { includeCompletions, includeDefinitions } from '../../src/includes/editor';

/** As much of the `vscode` module as src/includes/editor.ts and host.ts use. */
const fake = vi.hoisted(() => {
  class Position {
    constructor(
      public line: number,
      public character: number
    ) {}
  }
  class Range {
    start: Position;
    end: Position;
    constructor(a: number | Position, b: number | Position, c = 0, d = 0) {
      if (typeof a === 'number' && typeof b === 'number') {
        this.start = new Position(a, b);
        this.end = new Position(c, d);
      } else {
        this.start = a as Position;
        this.end = b as Position;
      }
    }
  }
  class CompletionItem {
    insertText?: string;
    range?: unknown;
    command?: unknown;
    constructor(
      public label: unknown,
      public kind?: number
    ) {}
  }
  const file = (fsPath: string): { scheme: string; fsPath: string; toString(): string } => ({
    scheme: 'file',
    fsPath,
    toString: () => `file:///${fsPath.replace(/\\/g, '/')}`,
  });
  return { Position, Range, CompletionItem, file, state: { trusted: true, folder: '' } };
});

vi.mock('vscode', () => ({
  Position: fake.Position,
  Range: fake.Range,
  CompletionItem: fake.CompletionItem,
  CompletionItemKind: { File: 16, Folder: 18 },
  Uri: { file: fake.file },
  workspace: {
    get isTrusted(): boolean {
      return fake.state.trusted;
    },
    getWorkspaceFolder: (uri: { fsPath: string }) =>
      uri.fsPath.startsWith(`${fake.state.folder}${sep}`) ? { uri: fake.file(fake.state.folder) } : undefined,
    textDocuments: [],
  },
}));

let temp: string;
let root: string;
let docs: string;
const host = { includePaths: (): unknown => ['lib'] };

beforeAll(async () => {
  temp = await realpath(await mkdtemp(join(tmpdir(), 'plantuml-local-editor-')));
  root = join(temp, 'ws');
  docs = join(root, 'docs');
  await mkdir(join(docs, 'parts'), { recursive: true });
  await mkdir(join(root, 'lib'), { recursive: true });
  await writeFile(join(docs, 'common.puml'), 'A -> B');
  await writeFile(join(docs, 'parts', 'a.iuml'), 'A -> B');
  await writeFile(join(root, 'lib', 'only-lib.puml'), 'A -> B');
  fake.state.folder = root;
});

afterAll(async () => {
  await rm(temp, { recursive: true, force: true });
});

beforeEach(() => {
  fake.state.trusted = true;
});

function documentOf(name: string, text: string, languageId = 'plantuml'): vscode.TextDocument {
  const lines = text.split('\n');
  return {
    uri: fake.file(join(docs, name)),
    languageId,
    version: 1,
    getText: () => text,
    lineAt: (line: number) => ({ text: lines[line] ?? '' }),
  } as unknown as vscode.TextDocument;
}

const at = (line: number, character: number): vscode.Position =>
  new fake.Position(line, character) as unknown as vscode.Position;
const token = {} as vscode.CancellationToken;
const context = {} as vscode.CompletionContext;

describe('includeDefinitions', () => {
  const definitions = includeDefinitions(host);
  const goTo = async (
    document: vscode.TextDocument,
    line: number,
    character: number
  ): Promise<{ target: string; from: [number, number, number] } | undefined> => {
    const found = (await definitions.provideDefinition(document, at(line, character), token)) as
      | vscode.LocationLink[]
      | undefined;
    const link = found?.[0];
    if (link === undefined) {
      return undefined;
    }
    const range = link.originSelectionRange;
    return {
      target: link.targetUri.fsPath,
      from: [range?.start.line ?? -1, range?.start.character ?? -1, range?.end.character ?? -1],
    };
  };

  const DIAGRAM = [
    '@startuml',
    '!include parts/a.iuml',
    '!include only-lib.puml',
    '!include $f',
    '!include missing.puml',
    '@enduml',
  ].join('\n');

  it('goes to the file the render reads, from anywhere on its path', async () => {
    const document = documentOf('diagram.puml', DIAGRAM);
    await expect(goTo(document, 1, 12)).resolves.toEqual({
      target: join(docs, 'parts', 'a.iuml'),
      from: [1, 9, 21],
    });
    await expect(goTo(document, 1, 21)).resolves.toMatchObject({ target: join(docs, 'parts', 'a.iuml') });
    await expect(goTo(document, 2, 10)).resolves.toMatchObject({ target: join(root, 'lib', 'only-lib.puml') });
  });

  it('goes nowhere from a path worked out by the engine, a file not found, or the directive', async () => {
    const document = documentOf('diagram.puml', DIAGRAM);
    await expect(goTo(document, 3, 10)).resolves.toBeUndefined();
    await expect(goTo(document, 4, 10)).resolves.toBeUndefined();
    await expect(goTo(document, 1, 3)).resolves.toBeUndefined();
    await expect(goTo(document, 0, 3)).resolves.toBeUndefined();
  });

  it('goes from the diagram blocks of a Markdown document, past their quote markers', async () => {
    const document = documentOf(
      'design.md',
      ['# Title', '> ```plantuml', '> !include common.puml', '> ```', '!include common.puml'].join('\n'),
      'markdown'
    );
    await expect(goTo(document, 2, 12)).resolves.toEqual({ target: join(docs, 'common.puml'), from: [2, 11, 22] });
    await expect(goTo(document, 4, 10)).resolves.toBeUndefined();
  });

  it('goes nowhere in Restricted Mode, where the render reads no file', async () => {
    fake.state.trusted = false;
    await expect(goTo(documentOf('diagram.puml', DIAGRAM), 1, 12)).resolves.toBeUndefined();
  });
});

describe('includeCompletions', () => {
  const completions = includeCompletions(host);
  type Offered = { label: string; description?: string; kind?: number; insert?: string; range: number[] };
  const complete = async (document: vscode.TextDocument, line: number, character: number): Promise<Offered[] | undefined> => {
    const items = (await completions.provideCompletionItems(document, at(line, character), token, context)) as
      | vscode.CompletionItem[]
      | undefined;
    return items?.map((item) => {
      const label = item.label as string | vscode.CompletionItemLabel;
      const range = item.range as { inserting: vscode.Range; replacing: vscode.Range };
      return {
        label: typeof label === 'string' ? label : label.label,
        ...(typeof label === 'string' ? {} : { description: label.description }),
        kind: item.kind,
        ...(item.insertText === undefined ? {} : { insert: item.insertText as string }),
        range: [range.inserting.start.character, range.inserting.end.character, range.replacing.end.character],
      };
    });
  };
  const labels = (offered: Offered[] | undefined): string[] => (offered ?? []).map((item) => item.label).sort();

  it('offers the names next to the document and in the search folders after the directive', async () => {
    const offered = await complete(documentOf('diagram.puml', '@startuml\n!include \n@enduml'), 1, 9);
    expect(labels(offered)).toEqual(['common.puml', 'only-lib.puml', 'parts']);
    expect(offered?.find((item) => item.label === 'only-lib.puml')).toMatchObject({ description: 'lib', kind: 16 });
    // A folder goes on: its slash is inserted and the list opens again.
    expect(offered?.find((item) => item.label === 'parts')).toMatchObject({ kind: 18, insert: 'parts/' });
    expect(offered?.[0]?.range).toEqual([9, 9, 9]);
  });

  it('replaces the name being typed only, up to the next separator', async () => {
    const inFolder = await complete(documentOf('diagram.puml', '@startuml\n!include parts/a\n@enduml'), 1, 16);
    expect(inFolder).toEqual([{ label: 'a.iuml', kind: 16, range: [15, 16, 16] }]);
    const before = await complete(documentOf('diagram.puml', '@startuml\n!include pa/a.iuml\n@enduml'), 1, 11);
    expect(before?.[0]?.range).toEqual([9, 11, 11]);
    // Before a separator a folder is its name alone: the slash is there.
    expect(before?.find((item) => item.label === 'parts')).toEqual({ label: 'parts', kind: 18, range: [9, 11, 11] });
    // A comment that ends the line, and a selector, stay.
    const commented = await complete(documentOf('diagram.puml', "!include co!PART /' note '/"), 0, 11);
    expect(commented?.[0]?.range).toEqual([9, 11, 11]);
  });

  it('offers names in the diagram blocks of a Markdown document, past their quote markers', async () => {
    const document = documentOf('design.md', ['> ```plantuml', '> !include pa', '> ```'].join('\n'), 'markdown');
    expect(labels(await complete(document, 1, 13))).toEqual(['common.puml', 'only-lib.puml', 'parts']);
    expect((await complete(document, 1, 13))?.[0]?.range).toEqual([11, 13, 13]);
  });

  it.each([
    ['a comment line', "' !include ", 0, 11],
    ['a block comment', "/'\n!include \n'/", 1, 9],
    ['a quoted path', '!include "co', 0, 12],
    ['a library', '!include <C4/', 0, 13],
    ['the directive', '!include common.puml', 0, 4],
    ['an unknown directive', '!includesub ', 0, 12],
  ])('offers nothing in %s', async (_where, text, line, character) => {
    await expect(complete(documentOf('diagram.puml', text), line, character)).resolves.toBeUndefined();
  });

  it('offers nothing outside the diagram blocks of a Markdown document', async () => {
    await expect(complete(documentOf('design.md', '!include ', 'markdown'), 0, 9)).resolves.toBeUndefined();
  });

  it('offers nothing in Restricted Mode, where the render reads no file', async () => {
    fake.state.trusted = false;
    await expect(complete(documentOf('diagram.puml', '!include '), 0, 9)).resolves.toBeUndefined();
  });
});
