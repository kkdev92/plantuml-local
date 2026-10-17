import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { RendererClient } from '../../src/render/client';
import { recognizeEngineError } from '../../src/render/engine-error';
import { IncludeSession, type IncludeAccess } from '../../src/includes/session';

/**
 * Local includes through the built worker and the bundled engine: the
 * engine asks, the worker passes the request on, the session answers.
 *
 * Skipped with an engine that has no file loader, as @plantuml/core
 * 1.2026.8 has none: its includes fail before anyone is asked.
 */

const workerPath = join(__dirname, '../../dist/worker.js');
const enginePath = join(__dirname, '../../dist/engine/plantuml.js');
const hasFileLoader = existsSync(enginePath) && readFileSync(enginePath, 'utf8').includes('PLANTUML_FILE_LOADER');

const log = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

/** The text of the drawing's labels, in order. */
function labels(svg: string): string[] {
  return [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((match) => match[1] ?? '');
}

describe.runIf(hasFileLoader)('local includes through the built worker', () => {
  let client: RendererClient;
  let temp: string;
  let root: string;
  let access: IncludeAccess;

  beforeAll(async () => {
    expect(existsSync(workerPath), 'dist/worker.js missing — run `npm run bundle` first').toBe(true);
    client = new RendererClient(workerPath, log);
    temp = await realpath(await mkdtemp(join(tmpdir(), 'plantuml-local-include-it-')));
    root = join(temp, 'ws');
    const docs = join(root, 'docs');
    await mkdir(join(docs, 'parts'), { recursive: true });
    await mkdir(join(root, 'styles'), { recursive: true });
    await mkdir(join(temp, 'outside'), { recursive: true });
    await writeFile(join(docs, 'common.puml'), 'Alice -> Bob : fromCommon\n');
    await writeFile(join(docs, 'parts', 'outer.puml'), '!include ./inner.puml\n');
    await writeFile(join(docs, 'parts', 'inner.puml'), 'Carol -> Dave : fromInner\n');
    await writeFile(join(docs, 'whole.puml'), "' a whole diagram\n@startuml\nEve -> Frank : fromWhole\n@enduml\n");
    await writeFile(join(docs, 'two.puml'), '@startuml\nA -> B\n@enduml\n@startuml\nC -> D\n@enduml\n');
    await writeFile(join(root, 'styles', 'skin.iuml'), 'Gina -> Hal : fromSearchFolder\n');
    await writeFile(join(temp, 'outside', 'secret.puml'), 'Mallory -> Bob : secret\n');
    await symlink(join(temp, 'outside'), join(docs, 'linked'), 'junction');
    access = {
      available: true,
      scope: { root, documentFolder: docs, searchFolders: [join(root, 'styles')] },
    };
  });

  afterAll(async () => {
    client.dispose();
    await rm(temp, { recursive: true, force: true });
  });

  const draw = async (
    ...lines: string[]
  ): Promise<{ svg: string; session: IncludeSession }> => {
    const session = new IncludeSession(access, () => undefined);
    const svg = await client.render(['@startuml', ...lines, '@enduml'].join('\n'), false, session.load);
    return { svg, session };
  };

  it('draws the lines of an included file', async () => {
    const { svg, session } = await draw('!include common.puml');
    expect(recognizeEngineError(svg)).toBeNull();
    expect(labels(svg)).toContain('fromCommon');
    expect(session.failures).toEqual([]);
  });

  it('follows an include written in an included file, next to that file', async () => {
    const { svg } = await draw('!include parts/outer.puml');
    expect(labels(svg)).toContain('fromInner');
  });

  it('takes a path from a variable, and a bare name from a search folder', async () => {
    const { svg } = await draw('!$file = "skin.iuml"', '!include $file');
    expect(labels(svg)).toContain('fromSearchFolder');
  });

  it('includes a file again only with !include_many', async () => {
    const once = await draw('!include common.puml', '!include common.puml');
    expect(labels(once.svg).filter((label) => label === 'fromCommon')).toHaveLength(1);
    const many = await draw('!include_many common.puml', '!include_many common.puml');
    expect(labels(many.svg).filter((label) => label === 'fromCommon')).toHaveLength(2);
  });

  it('fails a second !include_once of the same file, spelled another way', async () => {
    const { svg } = await draw('!include_once common.puml', '!include_once ./common.puml');
    expect(recognizeEngineError(svg)).not.toBeNull();
  });

  it('does not ask for a file behind a branch the diagram does not take', async () => {
    const { svg, session } = await draw('!if (0)', '!include missing.puml', '!endif', 'A -> B');
    expect(recognizeEngineError(svg)).toBeNull();
    expect(session.dependencies.size).toBe(0);
  });

  it('takes the inside of a file that holds a whole diagram', async () => {
    const { svg } = await draw('!include whole.puml');
    expect(recognizeEngineError(svg)).toBeNull();
    expect(labels(svg)).toContain('fromWhole');
  });

  it.each([
    ['../../outside/secret.puml', { kind: 'outside' }],
    ['linked/secret.puml', { kind: 'read', refusal: 'link' }],
    ['missing.puml', { kind: 'missing', searched: true }],
    ['two.puml', { kind: 'fragment', shape: 'several', line: 3 }],
  ])('refuses %s, naming the same path the engine names', async (path, reason) => {
    const { svg, session } = await draw(`!include ${path}`);
    expect(labels(svg)).not.toContain('secret');
    expect(recognizeEngineError(svg)?.message).toBe(`cannot include ${path}`);
    expect(session.failures).toEqual([{ path, reason }]);
  });

  it('refuses every include of a document that gets none', async () => {
    const session = new IncludeSession({ available: false, why: 'untrusted' }, () => undefined);
    const svg = await client.render('@startuml\n!include common.puml\n@enduml', false, session.load);
    expect(recognizeEngineError(svg)?.message).toBe('cannot include common.puml');
    expect(session.failures).toEqual([{ path: 'common.puml', reason: { kind: 'unavailable', why: 'untrusted' } }]);
  });

  it('fails a local include of a render given no loader, as before', async () => {
    const svg = await client.render('@startuml\n!include common.puml\n@enduml', false);
    expect(recognizeEngineError(svg)?.message).toBe('cannot include common.puml');
  });
});
