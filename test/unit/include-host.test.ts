import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IncludeLoader, ReplayFinding } from '../../src/core/types';
import type { IncludeLabels } from '../../src/includes/describe';
import { drawInDocuments, type Renderer } from '../../src/includes/host';
import { ReadSnapshot } from '../../src/includes/snapshot';

/** The few parts of `vscode` that drawing with includes reads. */
const fake = vi.hoisted(() => {
  const state = {
    trusted: true,
    folder: '',
    open: [] as { uri: { scheme: string; fsPath: string }; getText(): string }[],
  };
  const file = (fsPath: string): { scheme: string; fsPath: string; toString(): string } => ({
    scheme: 'file',
    fsPath,
    toString: () => `file://${fsPath}`,
  });
  return { state, file, parse: (value: string) => file(value.replace(/^file:\/\//, '')) };
});

vi.mock('vscode', () => ({
  Uri: { file: fake.file, parse: fake.parse },
  workspace: {
    get isTrusted(): boolean {
      return fake.state.trusted;
    },
    getWorkspaceFolder: (uri: { fsPath: string }) =>
      uri.fsPath.startsWith(`${fake.state.folder}${sep}`) ? { uri: fake.file(fake.state.folder) } : undefined,
    get textDocuments() {
      return fake.state.open;
    },
  },
}));

const labels = new Proxy({} as IncludeLabels, {
  get: (_target, name) => (typeof name === 'string' && /^(setting|extension|too)/.test(name) ? () => name : name),
});

const hash = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** An engine that asks for `paths` in turn, from the diagram, and draws what it was given. */
const asking = (...paths: string[]): Renderer & { draw: ReturnType<typeof vi.fn> } => ({
  draw: vi.fn(async (_source: string, _dark: boolean, load?: IncludeLoader) => {
    const given: string[] = [];
    for (const path of paths) {
      try {
        given.push((await load?.(path, null, 'include'))?.text ?? 'no loader');
      } catch {
        given.push('failed');
      }
    }
    return { svg: `<svg>${given.join('|')}</svg>`, libraries: [] };
  }),
});

const nothing = (): ReplayFinding[] => [];

describe('drawInDocuments', () => {
  let temp: string;
  let root: string;
  let docs: string;
  let common: string;
  let document: string;
  const host = { includePaths: (): unknown => ['lib'], labels };
  const diagram = '@startuml\n!include common.puml\n@enduml';

  beforeEach(async () => {
    temp = await realpath(await mkdtemp(join(tmpdir(), 'plantuml-local-host-')));
    root = join(temp, 'ws');
    docs = join(root, 'docs');
    await mkdir(docs, { recursive: true });
    await mkdir(join(root, 'lib'), { recursive: true });
    common = join(docs, 'common.puml');
    await writeFile(common, 'Alice -> Bob\n');
    document = fake.file(join(docs, 'guide.md')).toString();
    fake.state.folder = root;
    fake.state.trusted = true;
    fake.state.open = [];
  });

  afterEach(async () => {
    await rm(temp, { recursive: true, force: true });
  });

  it('says what a drawing for an export was drawn from: where it looked, what it asked for in order, and each file delivered once', async () => {
    const draw = drawInDocuments(asking('common.puml', 'gone.puml', 'common.puml'), host, new ReadSnapshot(nothing));

    const { inputs } = await draw('@startuml\n!include common.puml\n!include gone.puml\n@enduml', false, document);

    expect(inputs).toEqual({
      context: { root, folder: docs, searchFolders: [join(root, 'lib')] },
      requests: [
        { path: 'common.puml', from: null, kind: 'include', outcome: 'read', file: common, looked: [] },
        {
          path: 'gone.puml',
          from: null,
          kind: 'include',
          outcome: 'missing:searched',
          file: null,
          looked: [join(docs, 'gone.puml'), join(root, 'lib', 'gone.puml')],
        },
        { path: 'common.puml', from: null, kind: 'include', outcome: 'read', file: common, looked: [] },
      ],
      files: [{ file: common, sha256: hash('Alice -> Bob\n'), origin: 'disk', findings: [] }],
    });
  });

  it('says a diagram without a local include looked for nothing, and a drawing not for an export says nothing', async () => {
    const plain = '@startuml\nAlice -> Bob\n@enduml';

    expect((await drawInDocuments(asking(), host, new ReadSnapshot(nothing))(plain, false, document)).inputs).toEqual({
      context: null,
      requests: [],
      files: [],
    });
    expect(await drawInDocuments(asking('common.puml'), host)(diagram, false, document)).not.toHaveProperty('inputs');
  });

  it('draws again from what it read first, though the file changed in between, as an export draws a diagram in another palette', async () => {
    const renderer = asking('common.puml');
    const draw = drawInDocuments(renderer, host, new ReadSnapshot(nothing));

    const first = await draw(diagram, false, document);
    await writeFile(common, 'Carol -> Dave\n');
    const again = await draw(diagram, true, document);
    const afresh = await drawInDocuments(renderer, host, new ReadSnapshot(nothing))(diagram, false, document);

    expect(again.svg).toBe(first.svg);
    expect(again.inputs).toEqual(first.inputs);
    expect(afresh.svg).toBe('<svg>Carol -> Dave\n</svg>');
  });

  it('says a file was delivered as an editor holds it, and looks where the export first looked, though the workspace changed since', async () => {
    fake.state.open = [{ uri: fake.file(common), getText: () => 'Edited -> Text\n' }];
    const draw = drawInDocuments(asking('common.puml'), host, new ReadSnapshot(nothing));

    const first = await draw(diagram, false, document);
    fake.state.trusted = false;
    const again = await draw(diagram, false, document);

    expect(first.inputs?.files).toEqual([{ file: common, sha256: hash('Edited -> Text\n'), origin: 'editor', findings: [] }]);
    expect(again.inputs).toEqual(first.inputs);
  });

  it('says why nothing was read where none may be, in words that stay the same in every language', async () => {
    fake.state.trusted = false;
    const untrusted = await drawInDocuments(asking('common.puml'), host, new ReadSnapshot(nothing))(diagram, false, document);
    fake.state.trusted = true;
    const refused = await drawInDocuments(asking('/etc/common.puml', '../../outside.puml'), host, new ReadSnapshot(nothing))(
      '@startuml\n!include /etc/common.puml\n@enduml',
      false,
      document
    );

    expect(untrusted.inputs).toMatchObject({
      context: { unavailable: 'untrusted' },
      requests: [{ outcome: 'unavailable:untrusted', file: null, looked: [] }],
      files: [],
    });
    expect(refused.inputs?.requests.map(({ outcome }) => outcome)).toEqual(['path:absolute', 'outside']);
  });
});
