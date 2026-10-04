import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { changeTo, DependencyFolders, pathKey } from '../../src/includes/tracking';

describe('pathKey', () => {
  it('compares paths without case on Windows and macOS, as their file events are', () => {
    expect(pathKey('C:\\Work\\Docs\\Common.puml', 'win32')).toBe('c:\\work\\docs\\common.puml');
    expect(pathKey('/Users/me/Docs/Common.puml', 'darwin')).toBe('/users/me/docs/common.puml');
    expect(pathKey('/home/me/Docs/Common.puml', 'linux')).toBe('/home/me/Docs/Common.puml');
  });
});

describe('DependencyFolders', () => {
  const a = join('/ws', 'docs', 'a.puml');
  const b = join('/ws', 'docs', 'b.puml');
  const style = join('/ws', 'styles', 'skin.iuml');

  it('watches the folders of what a render depends on, once each', () => {
    const folders = new DependencyFolders();
    expect(folders.remember('one', [a, b, style])).toEqual({
      added: [join('/ws', 'docs'), join('/ws', 'styles')],
      removed: [],
    });
    expect(folders.remember('two', [a])).toEqual({ added: [], removed: [] });
    expect(folders.has(join('/ws', 'docs'))).toBe(true);
  });

  it('stops watching a folder once no render depends on it', () => {
    const folders = new DependencyFolders();
    folders.remember('one', [a, style]);
    folders.remember('two', [b]);
    expect(folders.remember('one', [a])).toEqual({ added: [], removed: [join('/ws', 'styles')] });
    expect(folders.remember('one', [])).toEqual({ added: [], removed: [] });
    expect(folders.remember('two', [])).toEqual({ added: [], removed: [join('/ws', 'docs')] });
    expect(folders.folders.size).toBe(0);
  });

  it('forgets the oldest render beyond the most it remembers', () => {
    const folders = new DependencyFolders(2);
    folders.remember('one', [style]);
    folders.remember('two', [a]);
    expect(folders.remember('three', [b])).toEqual({ added: [], removed: [join('/ws', 'styles')] });
  });

  it('counts a render remembered again as the newest', () => {
    const folders = new DependencyFolders(2);
    folders.remember('one', [style]);
    folders.remember('two', [a]);
    folders.remember('one', [style]);
    expect(folders.remember('three', [join('/other', 'c.puml')]).removed).toEqual([join('/ws', 'docs')]);
  });

  it('forgets everything at once', () => {
    const folders = new DependencyFolders();
    folders.remember('one', [a, style]);
    expect(folders.clear().sort()).toEqual([join('/ws', 'docs'), join('/ws', 'styles')].sort());
    expect(folders.has(join('/ws', 'docs'))).toBe(false);
  });
});

describe('changeTo', () => {
  const changes = new Map([
    ['/ws/a.puml', false],
    ['/ws/b.puml', true],
  ]);

  it('tells whether the paths were untouched, only edited, or saved or changed on disk', () => {
    expect(changeTo(['/ws/c.puml'], changes)).toBe('none');
    expect(changeTo(['/ws/a.puml', '/ws/c.puml'], changes)).toBe('edited');
    expect(changeTo(['/ws/a.puml', '/ws/b.puml'], changes)).toBe('saved');
  });
});
