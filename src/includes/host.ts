import { realpath } from 'node:fs/promises';
import { join, relative } from 'node:path';
import * as vscode from 'vscode';

import { INCLUDE_LIMITS } from '../core/constants';
import type { DiagramRender, DrawnRequest, DrawnRequestState, IncludeLoader, LibraryRead } from '../core/types';
import { RenderFailure, type Drawing } from '../render/client';
import { includeAccess } from './access';
import { describeIncludeFailure, describeIncludeFailures, hasLocalInclude, type IncludeLabels } from './describe';
import { DrawingFailure } from './drawings';
import { INCLUDE_EXTENSIONS } from './path-policy';
import { IncludeSession, type IncludeAccess, type IncludeFailureReason } from './session';
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

export function drawInDocuments(renderer: Renderer, host: IncludeHost): DrawDiagram {
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
      return { svg, failedIncludes: new Map(), dependencies: [], log: { requests: [], libraries } };
    }
    const { session, opened } = await openSession(vscode.Uri.parse(document), host);
    const requests = (): DrawnRequest[] => drawnRequests(session, opened, describe);
    const looked = (): string[] => [...session.dependencies].map((path) => pathKey(opened(path)));
    const { svg, libraries } = await draw(source, dark, session.load, requests, looked);
    const dependencies = looked();
    host.remember?.(`${document}\n${source}`, dependencies);
    const styled = session.themes.length > 0 || session.whitePageLibrary;
    return {
      svg,
      failedIncludes: describeIncludeFailures(session.failures, describe),
      dependencies,
      ...(styled ? { includedStyle: { themes: [...session.themes], whitePageLibrary: session.whitePageLibrary } } : {}),
      log: { requests: requests(), libraries },
    };
  };
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
 */
export async function openSession(
  document: vscode.Uri,
  host: Pick<IncludeHost, 'includePaths'>
): Promise<{ session: IncludeSession; opened: (path: string) => string; root: string | undefined }> {
  const { access, folder } = await accessFor(document, host);
  const opened = (path: string): string => asOpened(access, folder, path);
  return {
    session: new IncludeSession(access, (path) => openText(opened(path)) ?? openText(path)),
    opened,
    root: access.available ? access.scope.root : undefined,
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

/** The text of the document open at `path`, unsaved changes and all, its path compared as file events are. */
function openText(path: string): string | undefined {
  const key = pathKey(path);
  return vscode.workspace.textDocuments
    .find((document) => document.uri.scheme === 'file' && pathKey(document.uri.fsPath) === key)
    ?.getText();
}
