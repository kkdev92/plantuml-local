import { realpath } from 'node:fs/promises';
import { join, relative } from 'node:path';
import * as vscode from 'vscode';

import { INCLUDE_LIMITS } from '../core/constants';
import type {
  DeliveredFile,
  DiagramRender,
  DrawnInputs,
  DrawnRequest,
  DrawnRequestState,
  IncludeLoader,
  LibraryRead,
} from '../core/types';
import { RenderFailure, type Drawing } from '../render/client';
import { includeAccess } from './access';
import { describeIncludeFailure, describeIncludeFailures, hasLocalInclude, type IncludeLabels } from './describe';
import { DrawingFailure } from './drawings';
import { INCLUDE_EXTENSIONS } from './path-policy';
import { contextOf, IncludeSession, inputRequestsOf, type IncludeAccess, type IncludeFailureReason } from './session';
import type { ReadSnapshot } from './snapshot';
import { pathKey } from './tracking';

/**
 * Draws the diagrams of documents with their local includes: the editor's
 * side of src/includes/, which reads the workspace's trust, its folders,
 * the setting and the open documents.
 */

/** Draws `source`, a diagram written in `document` (a URI), next to which its local includes are looked for. */
export type DrawDiagram = (source: string, dark: boolean, document?: string) => Promise<DiagramRender>;

export interface IncludeHost {
  /** `plantumlLocal.includePaths` for `document`, as written. */
  includePaths(document: vscode.Uri): unknown;
  labels: IncludeLabels;
  /** Takes what the render `key` of a diagram with a local include depended on (path keys). */
  remember?(key: string, paths: readonly string[]): void;
}

/** The renderer, as far as drawing goes. */
export interface Renderer {
  draw(source: string, dark: boolean, load?: IncludeLoader): Promise<Drawing>;
}

/**
 * Draws with the includes `host` says where to look for; with `snapshot`,
 * the reads of an export, each drawing also says what it was drawn from
 * (DiagramRender.inputs).
 */
export function drawInDocuments(renderer: Renderer, host: IncludeHost, snapshot?: ReadSnapshot): DrawDiagram {
  const describe = (reason: IncludeFailureReason): string =>
    describeIncludeFailure(reason, host.labels, INCLUDE_EXTENSIONS, INCLUDE_LIMITS);

  /**
   * Draws with `load`; when the engine fails, the failure keeps the
   * `requests` asked for until then and the `dependencies` looked at.
   */
  const draw = async (
    source: string,
    dark: boolean,
    load: IncludeLoader | undefined,
    requests: () => readonly DrawnRequest[],
    dependencies: () => readonly string[]
  ): Promise<Drawing> => {
    try {
      return await renderer.draw(source, dark, load);
    } catch (error: unknown) {
      const libraries: readonly LibraryRead[] = error instanceof RenderFailure ? error.libraries : [];
      const message = error instanceof Error ? error.message : String(error);
      throw new DrawingFailure(message, { requests: requests(), libraries }, dependencies());
    }
  };

  return async (source, dark, document) => {
    // Without a local include the engine never asks for a file.
    if (document === undefined || !hasLocalInclude(source)) {
      const { svg, libraries } = await draw(source, dark, undefined, () => [], () => []);
      return {
        svg,
        failedIncludes: new Map(),
        dependencies: [],
        log: { requests: [], libraries },
        ...(snapshot === undefined ? {} : { inputs: { context: null, requests: [], files: [] } }),
      };
    }
    const { session, opened, access } = await openSession(vscode.Uri.parse(document), host, snapshot);
    const requests = (): DrawnRequest[] => drawnRequests(session, opened, describe);
    const looked = (): string[] => [...session.dependencies].map((path) => pathKey(opened(path)));
    let drawing: Drawing;
    try {
      drawing = await draw(source, dark, session.load, requests, looked);
    } finally {
      // Drawn from saved files alone, a drawing that looked at a file open
      // with unsaved changes — one read, or a place found empty that an
      // editor has a file for — is not what the saved files draw.
      if (snapshot?.savedOnly === true) {
        noteUnsavedAmong(snapshot, session.dependencies, opened);
      }
    }
    const { svg, libraries } = drawing;
    const dependencies = looked();
    host.remember?.(`${document}\n${source}`, dependencies);
    const styled = session.themes.length > 0 || session.whitePageLibrary;
    return {
      svg,
      failedIncludes: describeIncludeFailures(session.failures, describe),
      dependencies,
      ...(styled ? { includedStyle: { themes: [...session.themes], whitePageLibrary: session.whitePageLibrary } } : {}),
      log: { requests: requests(), libraries },
      ...(snapshot === undefined ? {} : { inputs: drawnInputs(session, access, snapshot) }),
    };
  };
}

/** What a drawing of `session` was drawn from: where it looked, what it asked for and the files `snapshot` delivered. */
function drawnInputs(session: IncludeSession, access: IncludeAccess, snapshot: ReadSnapshot): DrawnInputs {
  const requests = inputRequestsOf(session.requests);
  const files: DeliveredFile[] = [];
  for (const id of new Set(requests.flatMap(({ file }) => (file === null ? [] : [file])))) {
    const delivered = snapshot.delivered(id);
    if (delivered !== undefined) {
      files.push(delivered);
    }
  }
  return { context: contextOf(access), requests, files };
}

/** How a request that failed for `reason` ended. */
function stateOf(reason: IncludeFailureReason): DrawnRequestState {
  return reason.kind === 'read' ? 'refused' : reason.kind;
}

/**
 * The requests of `session`, each with the file read or why not, the paths
 * as `opened` gives them, and a failure in the words of `describe`.
 */
function drawnRequests(
  session: IncludeSession,
  opened: (path: string) => string,
  describe: (reason: IncludeFailureReason) => string
): DrawnRequest[] {
  return session.requests.map(({ path, from, kind, answer }): DrawnRequest => {
    const asked = { path, from, ...(kind === undefined ? {} : { kind }) };
    if ('delivered' in answer) {
      return { ...asked, state: 'read', id: answer.delivered, file: opened(answer.delivered), looked: answer.missing.map(opened) };
    }
    return { ...asked, state: stateOf(answer.failed), looked: answer.looked.map(opened), reason: describe(answer.failed) };
  });
}

/**
 * An include session for the diagrams of `document`, which reads an open
 * document as it is edited, as a render of them does; `opened` gives a
 * path it found as VS Code knows it ({@link asOpened}), and `root` the real
 * path of the workspace folder it reads in, undefined when it reads none.
 * With `snapshot`, the session reads what the export it belongs to has read
 * already, and looks where it first looked; and when the snapshot reads
 * saved files only, it reads an open document only as saved ({@link savedText}).
 */
export async function openSession(
  document: vscode.Uri,
  host: Pick<IncludeHost, 'includePaths'>,
  snapshot?: ReadSnapshot
): Promise<{ session: IncludeSession; opened: (path: string) => string; root: string | undefined; access: IncludeAccess }> {
  const { access, folder } = await (snapshot === undefined
    ? accessFor(document, host)
    : snapshot.access(document.toString(), () => accessFor(document, host)));
  const opened = (path: string): string => asOpened(access, folder, path);
  const editorText = (path: string): string | undefined => openText(opened(path)) ?? openText(path);
  const text = snapshot?.savedOnly === true ? savedText(snapshot, opened) : editorText;
  return {
    session:
      snapshot === undefined
        ? new IncludeSession(access, editorText)
        : new IncludeSession(access, text, INCLUDE_LIMITS, snapshot.reader(text)),
    opened,
    root: access.available ? access.scope.root : undefined,
    access,
  };
}

/**
 * Where the diagrams of `document` look for their local includes now, and
 * how they read a file — an open document as it is edited — apart from the
 * reads of any export: for looking again at what a drawing was drawn from
 * (src/export/recheck.ts). `opened` gives a path found as VS Code knows it;
 * `unsaved` says whether the document open at a path has unsaved changes.
 */
export async function readingNow(
  document: vscode.Uri,
  host: Pick<IncludeHost, 'includePaths'>
): Promise<{
  access: IncludeAccess;
  opened: (path: string) => string;
  openText: (path: string) => string | undefined;
  unsaved: (path: string) => boolean;
}> {
  const { access, folder } = await accessFor(document, host);
  const opened = (path: string): string => asOpened(access, folder, path);
  return {
    access,
    opened,
    openText: (path) => openText(opened(path)) ?? openText(path),
    unsaved: (path) => (openDocument(opened(path)) ?? openDocument(path))?.isDirty === true,
  };
}

/**
 * A path found under the real path of the workspace folder, as VS Code
 * knows it: under the folder as it was opened, which a link in its path can
 * make another path. `folder` is that folder, from {@link accessFor}.
 */
export function asOpened(access: IncludeAccess, folder: string | undefined, path: string): string {
  return access.available && folder !== undefined ? join(folder, relative(access.scope.root, path)) : path;
}

/** Whether the diagrams of `document` get their local includes, and its workspace folder's path as opened. */
export async function accessFor(
  document: vscode.Uri,
  host: Pick<IncludeHost, 'includePaths'>
): Promise<{ access: IncludeAccess; folder: string | undefined }> {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document);
  const folder = workspaceFolder?.uri.scheme === 'file' ? workspaceFolder.uri.fsPath : undefined;
  const access = await includeAccess(
    {
      trusted: vscode.workspace.isTrusted,
      untitled: document.scheme === 'untitled',
      scheme: document.scheme,
      path: document.scheme === 'file' ? document.fsPath : '',
      folder,
      includePaths: host.includePaths(document),
    },
    (path) => realpath(path)
  );
  return { access, folder };
}

/** The document open at `path`, its path compared as file events are. */
function openDocument(path: string): vscode.TextDocument | undefined {
  const key = pathKey(path);
  return vscode.workspace.textDocuments.find((document) => document.uri.scheme === 'file' && pathKey(document.uri.fsPath) === key);
}

/** The text of the document open at `path`, unsaved changes and all, its path compared as file events are. */
function openText(path: string): string | undefined {
  return openDocument(path)?.getText();
}

/**
 * Reads files for `snapshot` as they are saved: a document open in an
 * editor without unsaved changes as the editor has it — what was saved, in
 * the encoding it was opened in — and a file no editor has from disk. A
 * document with unsaved changes is noted in `snapshot` and read from disk
 * meanwhile: what is drawn from it is not used.
 */
function savedText(snapshot: ReadSnapshot, opened: (path: string) => string): (path: string) => string | undefined {
  return (path) => {
    const document = openDocument(opened(path)) ?? openDocument(path);
    if (document?.isDirty === true) {
      snapshot.noteUnsaved(document.uri.fsPath);
      return undefined;
    }
    return document?.getText();
  };
}

/** Notes in `snapshot` each of `paths` an editor has open with unsaved changes, `opened` giving a path as VS Code knows it. */
function noteUnsavedAmong(snapshot: ReadSnapshot, paths: Iterable<string>, opened: (path: string) => string): void {
  for (const path of paths) {
    const document = openDocument(opened(path)) ?? openDocument(path);
    if (document?.isDirty === true) {
      snapshot.noteUnsaved(document.uri.fsPath);
    }
  }
}
