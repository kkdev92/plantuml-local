/**
 * Enough of an ExtensionContext for the framework to build every capability
 * adapter. It wires storage, secrets and webviews at activation regardless of
 * whether the extension declares any, so these have to exist even though this
 * extension uses only the workspace state, where the export records are kept.
 */
export interface ContextStub {
  subscriptions: { dispose(): void }[];
  globalState: { get(): undefined; update(): Promise<void>; keys(): string[]; setKeysForSync(): void };
  workspaceState: { get(key: string): unknown; update(key: string, value: unknown): Promise<void>; keys(): string[] };
  secrets: { get(): Promise<undefined>; store(): Promise<void>; delete(): Promise<void> };
  extensionUri: unknown;
}

export function createContextStub(): ContextStub {
  const workspace = new Map<string, unknown>();
  return {
    subscriptions: [],
    globalState: {
      get: () => undefined,
      update: async () => undefined,
      keys: () => [],
      setKeysForSync: () => undefined,
    },
    workspaceState: {
      get: (key) => workspace.get(key),
      update: async (key, value) => {
        if (value === undefined) {
          workspace.delete(key);
        } else {
          workspace.set(key, value);
        }
      },
      keys: () => [...workspace.keys()],
    },
    secrets: { get: async () => undefined, store: async () => undefined, delete: async () => undefined },
    extensionUri: { scheme: 'file', fsPath: '/ext', toString: () => 'file:///ext' },
  };
}
