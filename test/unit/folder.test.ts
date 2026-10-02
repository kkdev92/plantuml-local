import { describe, expect, it } from 'vitest';

import { MAX_DOCUMENTS, findDocuments, type FolderDeps } from '../../src/export/folder';

/** A folder as nested objects: a file is 'file', a link 'link' to a file or folder. */
interface Tree {
  [name: string]: Tree | 'file' | 'link';
}

/** Lists `tree` as VS Code's file system would, with `vscode.FileType` flags. */
function depsOf(tree: Tree): FolderDeps & { read: string[] } {
  const read: string[] = [];
  return {
    read,
    readDirectory: (path) => {
      read.push(path);
      const node = path
        .split('/')
        .slice(1)
        .reduce<Tree | 'file' | 'link' | undefined>((at, name) => (typeof at === 'object' ? at[name] : undefined), tree);
      if (typeof node !== 'object') {
        return Promise.reject(new Error(`not a folder: ${path}`));
      }
      return Promise.resolve(
        Object.entries(node).map(([name, entry]) => [name, entry === 'file' ? 1 : entry === 'link' ? 2 | 64 : 2] as const)
      );
    },
    join: (path, name) => `${path}/${name}`,
  };
}

describe('findDocuments', () => {
  it('finds the Markdown and PlantUML files of a folder, directory by directory in name order', async () => {
    const deps = depsOf({
      'b.md': 'file',
      'a.puml': 'file',
      'notes.txt': 'file',
      'diagram.svg': 'file',
      sub: { 'c.markdown': 'file', 'd.iuml': 'file' },
    });

    expect(await findDocuments(deps, 'root')).toEqual([
      { path: 'root/a.puml', plantUml: true },
      { path: 'root/b.md', plantUml: false },
      { path: 'root/sub/c.markdown', plantUml: false },
      { path: 'root/sub/d.iuml', plantUml: true },
    ]);
  });

  it('skips version control and build folders, and follows no link', async () => {
    const deps = depsOf({
      '.git': { 'a.md': 'file' },
      '.hg': { 'a.md': 'file' },
      '.svn': { 'a.md': 'file' },
      node_modules: { 'a.md': 'file' },
      dist: { 'a.md': 'file' },
      build: { 'a.md': 'file' },
      linked: 'link',
      'linked.md': 'link',
      docs: { 'kept.md': 'file' },
    });

    expect(await findDocuments(deps, 'root')).toEqual([{ path: 'root/docs/kept.md', plantUml: false }]);
    expect(deps.read).toEqual(['root', 'root/docs']);
  });

  it('gives up past the most documents taken, rather than return part of them', async () => {
    const files = (count: number): Tree =>
      Object.fromEntries(Array.from({ length: count }, (_, index) => [`${String(index)}.md`, 'file' as const]));

    expect(await findDocuments(depsOf(files(MAX_DOCUMENTS)), 'root')).toHaveLength(MAX_DOCUMENTS);
    expect(await findDocuments(depsOf(files(MAX_DOCUMENTS + 1)), 'root')).toBeNull();
  });

  it('stops when told to', async () => {
    const deps = depsOf({ 'a.md': 'file' });

    expect(await findDocuments(deps, 'root', () => true)).toEqual([]);
    expect(deps.read).toEqual([]);
  });
});
