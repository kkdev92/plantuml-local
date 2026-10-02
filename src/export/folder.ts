/**
 * Finds the documents of a folder whose diagrams can be exported: the
 * Markdown and PlantUML files under it.
 *
 * The folder is walked here rather than searched with `findFiles`, which
 * applies the user's exclude settings and does not say what it does with
 * links. The walk skips version-control and build folders (`.git`, `.hg`,
 * `.svn`, `node_modules`, `dist`, `build`) and follows no link: VS Code's
 * file system marks a symbolic link or a junction as one, whatever it
 * points to. It gives up past {@link MAX_DOCUMENTS}, so that part of a
 * folder is never exported as if it were the whole.
 *
 * Like the exporter, this has no dependency on the `vscode` module: the
 * caller lists directories and joins paths.
 */

export interface FolderDeps {
  /** The entries of the directory at `path`: names and `vscode.FileType` flags. */
  readDirectory(path: string): Promise<readonly (readonly [string, number])[]>;
  /** `path` with `name` appended. */
  join(path: string, name: string): string;
}

/** `vscode.FileType`. */
const FILE = 1;
const DIRECTORY = 2;
const SYMBOLIC_LINK = 64;

const SKIPPED = new Set(['.git', '.hg', '.svn', 'node_modules', 'dist', 'build']);
/** The extensions VS Code opens as Markdown. */
const MARKDOWN = /\.(?:md|mkd|mkdn|mdwn|mdown|markdown|markdn|mdtxt|mdtext|litcoffee|ron|ronn|workbook)$/i;
/** The extensions this extension opens as PlantUML. */
const PLANTUML = /\.(?:puml|plantuml|pu|iuml|wsd)$/i;

/** The most documents taken from one folder. */
export const MAX_DOCUMENTS = 500;

export interface FoundDocument {
  path: string;
  plantUml: boolean;
}

/**
 * The Markdown and PlantUML files under `folder`, directory by directory in
 * name order, or null when there are more than {@link MAX_DOCUMENTS}.
 * `stopped` ends the walk early, for a cancel.
 */
export async function findDocuments(
  deps: FolderDeps,
  folder: string,
  stopped: () => boolean = () => false
): Promise<FoundDocument[] | null> {
  const found: FoundDocument[] = [];
  const pending = [folder];
  while (pending.length > 0 && !stopped()) {
    const directory = pending.shift() ?? folder;
    const entries = [...(await deps.readDirectory(directory))].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (const [name, type] of entries) {
      if ((type & SYMBOLIC_LINK) !== 0) {
        continue;
      }
      const path = deps.join(directory, name);
      if (type === DIRECTORY && !SKIPPED.has(name)) {
        pending.push(path);
      } else if (type === FILE && (MARKDOWN.test(name) || PLANTUML.test(name))) {
        found.push({ path, plantUml: PLANTUML.test(name) });
        if (found.length > MAX_DOCUMENTS) {
          return null;
        }
      }
    }
  }
  return found;
}
