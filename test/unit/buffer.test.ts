import { describe, expect, it, vi } from 'vitest';

import { digestOf, OutputBuffer, sameDigest, type SpoolDeps } from '../../src/export/buffer';
import { sha256 } from '../../src/export/ownership';

/** Files spool writes, by name, and what it did with them, in order. */
function makeSpool(made: readonly (readonly string[])[] = []): SpoolDeps & {
  files: Map<string, Uint8Array>;
  log: string[];
  spool: ReturnType<typeof vi.fn>;
} {
  const files = new Map<string, Uint8Array>();
  const log: string[] = [];
  let count = 0;
  return {
    files,
    log,
    spool: vi.fn((path: string, bytes: Uint8Array) => {
      const file = `${path}.${String(count)}.tmp`;
      files.set(file, Uint8Array.from(bytes));
      log.push(`spool ${file}`);
      return Promise.resolve({ file, made: made[count++] ?? [] });
    }),
    readSpool: (file) => Promise.resolve(files.get(file) ?? null),
    deleteSpool: (file) => {
      files.delete(file);
      log.push(`delete ${file}`);
      return Promise.resolve();
    },
    deleteFolder: (folder) => {
      log.push(`delete folder ${folder}`);
      return Promise.resolve();
    },
  };
}

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('digestOf', () => {
  it('knows text by its UTF-8 bytes', () => {
    expect(digestOf('図')).toEqual({ size: 3, sha256: sha256(bytes('図')) });
    expect(sameDigest(digestOf('図'), digestOf(bytes('図')))).toBe(true);
    expect(sameDigest(digestOf('a'), digestOf('b'))).toBe(false);
    expect(sameDigest({ size: 1, sha256: sha256(bytes('a')) }, { size: 2, sha256: sha256(bytes('a')) })).toBe(false);
  });
});

describe('OutputBuffer', () => {
  it('holds drawings in memory while there is room, and the rest in files beside their own', async () => {
    const spool = makeSpool();
    const buffer = new OutputBuffer(spool, 10);

    const first = await buffer.hold('/a/one.svg', 'abcdef');
    const second = await buffer.hold('/a/two.png', bytes('ghijk'));
    const third = await buffer.hold('/a/three.svg', 'lmnn');

    expect(spool.spool.mock.calls).toEqual([['/a/two.png', bytes('ghijk')]]);
    expect(await buffer.read(first)).toBe('abcdef');
    expect(await buffer.read(second)).toEqual(bytes('ghijk'));
    expect(await buffer.read(third)).toBe('lmnn');
    expect(second).toEqual(digestOf('ghijk'));
  });

  it('takes back the room of a drawing let go of', async () => {
    const spool = makeSpool();
    const buffer = new OutputBuffer(spool, 10);

    await buffer.release(await buffer.hold('/a/one.svg', 'abcdef'));
    const again = await buffer.hold('/a/two.svg', 'ghijkl');

    expect(spool.spool).not.toHaveBeenCalled();
    expect(await buffer.read(again)).toBe('ghijkl');
  });

  it('tells apart two drawings of the same bytes', async () => {
    const buffer = new OutputBuffer(makeSpool(), 10);
    const first = await buffer.hold('/a/one.svg', 'same');
    const second = await buffer.hold('/a/two.svg', 'same');

    await buffer.release(first);

    expect(await buffer.read(first)).toBeNull();
    expect(await buffer.read(second)).toBe('same');
  });

  it('reads a file back only while it holds what was put there', async () => {
    const spool = makeSpool();
    const buffer = new OutputBuffer(spool, 0);
    const changed = await buffer.hold('/a/one.svg', 'abc');
    const gone = await buffer.hold('/a/two.svg', 'def');
    const longer = await buffer.hold('/a/three.svg', 'ghi');
    const kept = await buffer.hold('/a/four.svg', 'jkl');
    spool.files.set('/a/one.svg.0.tmp', bytes('abd'));
    spool.files.delete('/a/two.svg.1.tmp');
    spool.files.set('/a/three.svg.2.tmp', bytes('ghi '));

    expect(await buffer.read(changed)).toBeNull();
    expect(await buffer.read(gone)).toBeNull();
    expect(await buffer.read(longer)).toBeNull();
    expect(await buffer.read(kept)).toEqual(bytes('jkl'));
    await buffer.release(kept);
    expect(await buffer.read(kept)).toBeNull();
  });

  it('deletes a file once its drawing is let go of, then those left and the folders made for them, the last made first', async () => {
    const spool = makeSpool([['/a/x', '/a/x/y'], [], ['/a/z']]);
    const buffer = new OutputBuffer(spool, 3);
    const inMemory = await buffer.hold('/a/zero.svg', 'abc');
    const first = await buffer.hold('/a/x/y/one.svg', 'def');
    await buffer.hold('/a/x/y/two.svg', 'ghi');
    await buffer.hold('/a/z/three.svg', 'jkl');

    await buffer.release(first);
    await buffer.dispose();

    expect(spool.log).toEqual([
      'spool /a/x/y/one.svg.0.tmp',
      'spool /a/x/y/two.svg.1.tmp',
      'spool /a/z/three.svg.2.tmp',
      'delete /a/x/y/one.svg.0.tmp',
      'delete /a/x/y/two.svg.1.tmp',
      'delete /a/z/three.svg.2.tmp',
      'delete folder /a/z',
      'delete folder /a/x/y',
      'delete folder /a/x',
    ]);
    expect(spool.files.size).toBe(0);
    expect(await buffer.read(inMemory)).toBeNull();

    // Once is enough: nothing is left to delete.
    await buffer.dispose();
    expect(spool.log).toHaveLength(9);
  });

  it('holds nothing it could not put in a file', async () => {
    const spool = makeSpool();
    spool.spool.mockRejectedValueOnce(new Error('EACCES'));
    const buffer = new OutputBuffer(spool, 0);

    await expect(buffer.hold('/a/one.svg', 'abc')).rejects.toThrow('EACCES');
    await buffer.dispose();

    expect(spool.log).toEqual([]);
  });
});
