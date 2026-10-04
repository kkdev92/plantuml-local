import { realpath } from 'node:fs/promises';
import * as vscode from 'vscode';

import { INCLUDE_LIMITS } from '../core/constants';
import type { DiagramRender, IncludeLoader } from '../core/types';
import { includeAccess } from './access';
import { describeIncludeFailure, describeIncludeFailures, hasLocalInclude, type IncludeLabels } from './describe';
import { INCLUDE_EXTENSIONS } from './path-policy';
import { IncludeSession, type IncludeAccess, type IncludeFailureReason } from './session';

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
      return { svg: await renderer.render(source, dark), failedIncludes: new Map() };
    }
    const session = new IncludeSession(await accessFor(vscode.Uri.parse(document), host), openText);
    const svg = await renderer.render(source, dark, session.load);
    return { svg, failedIncludes: describeIncludeFailures(session.failures, describe) };
  };
}

function accessFor(document: vscode.Uri, host: IncludeHost): Promise<IncludeAccess> {
  const folder = vscode.workspace.getWorkspaceFolder(document);
  return includeAccess(
    {
      trusted: vscode.workspace.isTrusted,
      untitled: document.scheme === 'untitled',
      scheme: document.scheme,
      path: document.scheme === 'file' ? document.fsPath : '',
      folder: folder?.uri.scheme === 'file' ? folder.uri.fsPath : undefined,
      includePaths: host.includePaths(document),
    },
    (path) => realpath(path)
  );
}

/**
 * The text of the document open at `path`, a real path, unsaved changes and
 * all. The real path has the drive letter and the names as they are on
 * disk, where a document's path may not, so Windows compares without case.
 */
function openText(path: string): string | undefined {
  const same =
    process.platform === 'win32'
      ? (a: string): boolean => a.toLowerCase() === path.toLowerCase()
      : (a: string): boolean => a === path;
  return vscode.workspace.textDocuments
    .find((document) => document.uri.scheme === 'file' && same(document.uri.fsPath))
    ?.getText();
}
