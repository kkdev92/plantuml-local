import { realpath } from 'node:fs/promises';
import { join, relative } from 'node:path';
import * as vscode from 'vscode';

import { INCLUDE_LIMITS } from '../core/constants';
import type { DiagramRender, IncludeLoader } from '../core/types';
import { includeAccess } from './access';
import { describeIncludeFailure, describeIncludeFailures, hasLocalInclude, type IncludeLabels } from './describe';
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
  render(source: string, dark: boolean, load?: IncludeLoader): Promise<string>;
}

export function drawInDocuments(renderer: Renderer, host: IncludeHost): DrawDiagram {
  const describe = (reason: IncludeFailureReason): string =>
    describeIncludeFailure(reason, host.labels, INCLUDE_EXTENSIONS, INCLUDE_LIMITS);

  return async (source, dark, document) => {
    // Without a local include the engine never asks for a file.
    if (document === undefined || !hasLocalInclude(source)) {
      return { svg: await renderer.render(source, dark), failedIncludes: new Map(), dependencies: [] };
    }
    const { access, folder } = await accessFor(vscode.Uri.parse(document), host);
    const opened = (path: string): string => asOpened(access, folder, path);
    const session = new IncludeSession(access, (path) => openText(opened(path)) ?? openText(path));
    const svg = await renderer.render(source, dark, session.load);
    const dependencies = [...session.dependencies].map((path) => pathKey(opened(path)));
    host.remember?.(`${document}\n${source}`, dependencies);
    const styled = session.themes.length > 0 || session.azure;
    return {
      svg,
      failedIncludes: describeIncludeFailures(session.failures, describe),
      dependencies,
      ...(styled ? { includedStyle: { themes: [...session.themes], azure: session.azure } } : {}),
    };
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
