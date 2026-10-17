import * as vscode from 'vscode';

import { findPlantUmlBlocks, type PlantUmlBlock } from '../export/blocks';
import { lineContext } from '../language/completion';
import { includeDirectives, includePathOf } from './directives';
import { accessFor, asOpened, type IncludeHost } from './host';
import { includeEntries, includeTarget } from './targets';

/**
 * Goes to the file a local `!include` reads, and offers the names its path
 * can go on with, in PlantUML files and in the diagram blocks of Markdown
 * documents: the editor's side of directives.ts and targets.ts.
 *
 * Going there is a definition (Ctrl+Click, F12, Peek), not a document link
 * as well: VS Code runs both on one Ctrl+Click, which would open the file
 * twice. Where the render reads no file — Restricted Mode, a document not
 * on disk or outside the workspace folders — nothing is looked for.
 */

/** The diagram a line of a document is in. */
interface Diagram {
  text: string;
  /** The document's line of its first line. */
  firstLine: number;
  /** Columns before each of its lines: the quote markers or indent of a Markdown block. */
  offsets: readonly number[];
}

/** The diagram blocks of a Markdown document, found once for each of its versions. */
function blocksOf(): (document: vscode.TextDocument) => readonly PlantUmlBlock[] {
  let scanned = '';
  let blocks: readonly PlantUmlBlock[] = [];
  return (document) => {
    const stamp = `${document.uri.toString()}#${String(document.version)}`;
    if (stamp !== scanned) {
      blocks = findPlantUmlBlocks(document.getText());
      scanned = stamp;
    }
    return blocks;
  };
}

function diagramAt(
  document: vscode.TextDocument,
  line: number,
  blocks: (document: vscode.TextDocument) => readonly PlantUmlBlock[]
): Diagram | null {
  if (document.languageId !== 'markdown') {
    return { text: document.getText(), firstLine: 0, offsets: [] };
  }
  const block = blocks(document).find(
    (candidate) =>
      line > candidate.openLine &&
      (line < candidate.closeLine || (!candidate.closed && line === candidate.closeLine))
  );
  if (block === undefined) {
    return null;
  }
  const last = block.closed ? block.closeLine - 1 : block.closeLine;
  const lines: string[] = [];
  const offsets: number[] = [];
  for (let at = block.openLine + 1; at <= last; at++) {
    const body = document.lineAt(at).text;
    const offset = body.startsWith(block.container) ? block.container.length : 0;
    lines.push(body.slice(offset));
    offsets.push(offset);
  }
  return { text: lines.join('\n'), firstLine: block.openLine + 1, offsets };
}

export function includeDefinitions(host: Pick<IncludeHost, 'includePaths'>): vscode.DefinitionProvider {
  const blocks = blocksOf();
  return {
    provideDefinition: async (document, position): Promise<vscode.LocationLink[] | undefined> => {
      if (!document.lineAt(position.line).text.includes('!include')) {
        return undefined;
      }
      const diagram = diagramAt(document, position.line, blocks);
      if (diagram === null) {
        return undefined;
      }
      const row = position.line - diagram.firstLine;
      const offset = diagram.offsets[row] ?? 0;
      const column = position.character - offset;
      // Only a path taken as written: which line asked for a file the
      // engine worked out, a drawing does not tell.
      const directive = includeDirectives(diagram.text).find(
        (found) => found.line === row && found.literal && column >= found.start && column <= found.end
      );
      if (directive === undefined) {
        return undefined;
      }
      const { access, folder } = await accessFor(document.uri, host);
      if (!access.available) {
        return undefined;
      }
      const target = await includeTarget(directive.path, access.scope);
      if (target === null) {
        return undefined;
      }
      const link: vscode.LocationLink = {
        originSelectionRange: new vscode.Range(
          position.line,
          offset + directive.start,
          position.line,
          offset + directive.end
        ),
        targetUri: vscode.Uri.file(asOpened(access, folder, target)),
        targetRange: new vscode.Range(0, 0, 0, 0),
      };
      return [link];
    },
  };
}

export function includeCompletions(host: Pick<IncludeHost, 'includePaths'>): vscode.CompletionItemProvider {
  const blocks = blocksOf();
  return {
    provideCompletionItems: async (document, position): Promise<vscode.CompletionItem[] | undefined> => {
      const before = document.lineAt(position.line).text.slice(0, position.character);
      if (!/^[\s>]*!include(?:_once|_many)?\s/.test(before)) {
        return undefined;
      }
      const diagram = diagramAt(document, position.line, blocks);
      if (diagram === null) {
        return undefined;
      }
      const row = position.line - diagram.firstLine;
      const offset = diagram.offsets[row] ?? 0;
      const line = document.lineAt(position.line).text.slice(offset);
      const column = position.character - offset;
      const path = includePathOf(line);
      // A quoted path is asked for with its quotes, and never found.
      if (path === null || column < path.start || column > path.end || path.path.startsWith('"')) {
        return undefined;
      }
      if (lineContext(diagram.text, row) === null) {
        return undefined;
      }

      // The name being typed is replaced, up to the next separator.
      const typed = line.slice(path.start, column);
      const cut = Math.max(typed.lastIndexOf('/'), typed.lastIndexOf('\\')) + 1;
      const next = line.slice(column, path.end).search(/[\\/]/);
      const start = new vscode.Position(position.line, offset + path.start + cut);
      const end = new vscode.Position(position.line, next === -1 ? offset + path.end : position.character + next);

      const { access } = await accessFor(document.uri, host);
      if (!access.available) {
        return undefined;
      }
      const entries = await includeEntries(typed.slice(0, cut), access.scope);
      return entries.map((entry) => {
        const item = new vscode.CompletionItem(
          entry.searchFolder === null ? entry.name : { label: entry.name, description: entry.searchFolder },
          entry.folder ? vscode.CompletionItemKind.Folder : vscode.CompletionItemKind.File
        );
        item.range = { inserting: new vscode.Range(start, position), replacing: new vscode.Range(start, end) };
        // A folder at the end of the path goes on: its slash, and the list again.
        if (entry.folder && next === -1) {
          item.insertText = `${entry.name}/`;
          item.command = { command: 'editor.action.triggerSuggest', title: '' };
        }
        return item;
      });
    },
  };
}
