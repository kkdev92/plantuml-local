import { describe, expect, it } from 'vitest';
import { ViewerSelection } from '../../src/viewer/selection';

const block = (label: string, id = '') => ['@startuml' + (id && '(id=' + id + ')'), 'A -> B : ' + label, '@enduml'].join('\r\n');
const before = block('前😀') + '\r\n';
const second = block('本文');
const uriName = 'flows';

describe('tracking a viewer selection', () => {
  it('replays sequential UTF-16 changes and preserves the visited opening line and view', () => {
    const s = new ViewerSelection(uriName);
    s.read(before + second);
    s.choose(1);
    const key = s.current?.key;
    const prefix = "' コメント😀\r\n";
    s.read(prefix + second, [
      { rangeOffset: 0, rangeLength: before.length, text: '' },
      { rangeOffset: 0, rangeLength: 0, text: prefix },
    ]);
    expect(s.current).toMatchObject({ key, index: 0 });
    const end = s.text.indexOf('@enduml');
    s.read(s.text.slice(0, end), [{ rangeOffset: end, rangeLength: 7, text: '' }]);
    expect(s.current?.key).toBe(key);
    expect(s.diagrams[0]?.closed).toBe(false);
  });

  it('does not reuse an opening line after replacement, missed changes, or a new document', () => {
    for (const kind of ['replace', 'missed', 'reopen', 'overlap', 'invalid']) {
      const s = new ViewerSelection(uriName);
      s.read(before + second);
      s.choose(1);
      const key = s.current?.key;
      switch (kind) {
        case 'replace': s.read(s.text, [{ rangeOffset: before.length, rangeLength: 9, text: '@startuml' }]); break;
        case 'missed': s.read(second); break;
        case 'reopen': s.read(s.text, undefined, true); break;
        case 'overlap': s.read(s.text.replace(second, 'X' + second), [{ rangeOffset: before.length, rangeLength: 0, text: 'X' }]); break;
        case 'invalid': s.read(second, [{ rangeOffset: -1, rangeLength: 0, text: '' }]); break;
      }
      expect(s.current, kind).toBeUndefined();
      expect(s.waiting).toBe(false);
      s.choose(0);
      expect(s.current?.key).not.toBe(key);
    }
  });

  it('tracks unique explicit IDs through reordering and retires them on duplication', () => {
    const s = new ViewerSelection(uriName);
    const a = block('A', 'orders'), b = block('B', 'orders');
    s.read(before + a);
    s.choose(1);
    const key = s.current?.key;
    s.read(a + '\r\n' + before);
    expect(s.current).toMatchObject({ index: 0, key });
    s.read(a + '\r\n' + b);
    expect(s.current).toBeUndefined();
    s.choose(0);
    const first = s.current?.key;
    s.choose(1);
    expect(s.current?.key).not.toBe(first);
    expect(s.saved()).toEqual({ name: null, nameBasis: null });
    s.choose(0);
    expect(s.current?.key).toBe(first);
  });

  it('keeps a file-named opening line distinct from a newly declared ID of the same name', () => {
    const s = new ViewerSelection(uriName);
    s.read(second);
    const key = s.current?.key;
    const prefix = block('another', uriName) + '\r\n';
    s.read(prefix + second, [{ rangeOffset: 0, rangeLength: 0, text: prefix }]);
    expect(s.current).toMatchObject({ key, index: 1 });
    expect(s.saved().name).toBeNull();
  });

  it('distinguishes an initially empty document, a bare diagram and a lost selection', () => {
    const s = new ViewerSelection(uriName);
    s.read("' still empty");
    expect(s.waiting).toBe(true);
    s.read('A -> B');
    const key = s.current?.key;
    s.read('A -> B : changed');
    expect(s.current?.key).toBe(key);
    s.read(second);
    expect(s.current).toBeUndefined();
    s.choose(0);
    s.read('');
    s.read(second);
    expect(s.current).toBeUndefined();
  });

  it('only restores a name with an unambiguous origin', () => {
    const s = new ViewerSelection(uriName);
    s.read(block('A', uriName) + '\n' + block('B', 'orders'));
    for (const state of [{ name: uriName }, { stateVersion: 9, name: 'orders' }, { name: 'orders', nameBasis: 'explicit-id' },
      { stateVersion: 2, name: 'orders', nameBasis: 'other' }, { name: 3 }]) {
      s.restore(state);
      expect(s.current).toBeUndefined();
    }
    s.restore({ stateVersion: 2, name: uriName, nameBasis: 'explicit-id' });
    expect(s.current?.index).toBe(0);
    s.restore({ name: 'orders' });
    expect(s.current?.index).toBe(1);
    s.read(second);
    s.restore({ name: uriName });
    expect(s.current?.index).toBe(0);
  });
});
