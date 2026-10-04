import { dirname } from 'node:path';
import * as vscode from 'vscode';

import { DependencyFolders, pathKey } from './tracking';

/**
 * Tells when a file that a diagram with a local include depends on changes:
 * edited in the editor, saved, closed with its changes thrown away, or
 * created, changed or deleted on disk.
 *
 * The folders of the files are watched with a pattern that does not recurse,
 * which VS Code serves from its watcher of the workspace and, for a folder
 * that `files.watcherExclude` leaves out, from a watcher of its own. It reads
 * the setting as a watcher is created, so the watchers are created again when
 * it changes. That watcher of its own reports nothing for an exclude pattern
 * ending in `/**`, such as `**\/generated/**`: VS Code (1.140) appends another
 * `/**`, which then matches no file. A change made outside VS Code in such a
 * folder goes unseen; one made in the editor is still seen.
 *
 * Saving a file reports it twice, as saved and as changed on disk; changes
 * are gathered for a moment and reported at once, each path saying whether
 * it was saved or changed on disk (true) or only edited (false).
 */

/** How long changes are gathered before they are reported, in milliseconds. */
const GATHER_MS = 100;

export class IncludeWatcher implements vscode.Disposable {
  private readonly folders = new DependencyFolders();
  private readonly watchers = new Map<string, vscode.FileSystemWatcher>();
  private readonly emitter = new vscode.EventEmitter<ReadonlyMap<string, boolean>>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private pending = new Map<string, boolean>();
  private timer: NodeJS.Timeout | undefined;

  /** Fires with the changed path keys, each true when saved or changed on disk. */
  readonly onDidChange = this.emitter.event;

  constructor() {
    this.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.contentChanges.length > 0) {
          this.note(event.document.uri, false);
        }
      }),
      vscode.workspace.onDidSaveTextDocument((document) => {
        this.note(document.uri, true);
      }),
      // Unsaved changes thrown away: the file on disk is what is read now.
      vscode.workspace.onDidCloseTextDocument((document) => {
        this.note(document.uri, true);
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('files.watcherExclude')) {
          this.rewatch();
        }
      })
    );
  }

  /** Remembers that the render `key` depends on `paths` (path keys). */
  remember(key: string, paths: readonly string[]): void {
    const { added, removed } = this.folders.remember(key, paths);
    for (const folder of removed) {
      this.watchers.get(folder)?.dispose();
      this.watchers.delete(folder);
    }
    for (const folder of added) {
      this.watch(folder);
    }
  }

  private watch(folder: string): void {
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(folder), '*'));
    const changed = (uri: vscode.Uri): void => {
      this.note(uri, true);
    };
    watcher.onDidCreate(changed);
    watcher.onDidChange(changed);
    watcher.onDidDelete(changed);
    this.watchers.set(folder, watcher);
  }

  /** Creates every watcher again, with `files.watcherExclude` as it is now. */
  private rewatch(): void {
    for (const watcher of this.watchers.values()) {
      watcher.dispose();
    }
    this.watchers.clear();
    for (const folder of this.folders.folders) {
      this.watch(folder);
    }
  }

  dispose(): void {
    clearTimeout(this.timer);
    for (const watcher of this.watchers.values()) {
      watcher.dispose();
    }
    this.watchers.clear();
    this.folders.clear();
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.emitter.dispose();
  }

  private note(uri: vscode.Uri, saved: boolean): void {
    if (uri.scheme !== 'file') {
      return;
    }
    const key = pathKey(uri.fsPath);
    // Only a folder some diagram depends on: every keystroke anywhere comes here.
    if (!this.folders.has(dirname(key))) {
      return;
    }
    this.pending.set(key, this.pending.get(key) === true || saved);
    if (this.timer === undefined) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        const changes = this.pending;
        this.pending = new Map();
        this.emitter.fire(changes);
      }, GATHER_MS);
    }
  }
}
