import { describe, expect, it } from 'vitest';

import type { DrawingLog, DrawnRequest } from '../../src/core/types';
import { dependencyTree, type DependencyNode, type RequestNode } from '../../src/includes/dependency-tree';
import { includeDirectives } from '../../src/includes/directives';

/** A request of the diagram (`from` null) or of a file, read when `id` is given. */
function asked(path: string, from: string | null, id?: string, more: Partial<DrawnRequest> = {}): DrawnRequest {
  return id === undefined
    ? { path, from, kind: 'include', state: 'missing', looked: [], reason: 'not found', ...more }
    : { path, from, kind: 'include', state: 'read', id, file: id, looked: [], ...more };
}

const log = (...requests: DrawnRequest[]): DrawingLog => ({ requests, libraries: [] });

/** The tree as paths, with what is said of each request. */
function shape(nodes: readonly DependencyNode[]): unknown[] {
  return nodes.map((node) => {
    switch (node.type) {
      case 'request':
        return [
          node.request.path,
          ...(node.repeat === undefined ? [] : [node.repeat]),
          ...(node.lines.length === 0 ? [] : [{ lines: node.lines }]),
          ...(node.readBefore === undefined ? [] : [{ readBefore: node.readBefore }]),
          ...(node.children.length === 0 ? [] : [shape(node.children)]),
        ];
      case 'lines':
        return { lines: node.lines.map((line) => [line.directive.line, line.directive.path, line.why]) };
      case 'libraries':
        return { libraries: node.libraries.map((read) => `${read.library}/${read.key}`) };
      case 'more':
        return { more: node.count };
    }
  });
}

describe('dependencyTree', () => {
  it('puts each request under the file it was asked from, in the order asked', () => {
    const tree = dependencyTree(
      log(asked('a.puml', null, '/ws/a.puml'), asked('b.puml', '/ws/a.puml', '/ws/b.puml'), asked('c.puml', null, '/ws/c.puml')),
      []
    );
    expect(shape(tree)).toEqual([['a.puml', [['b.puml']]], ['c.puml']]);
  });

  it('opens up a file once: a cycle and a second request for it are said, not opened up again', () => {
    const tree = dependencyTree(
      log(
        asked('p.puml', null, '/ws/p.puml'),
        asked('q.puml', '/ws/p.puml', '/ws/q.puml'),
        asked('p.puml', '/ws/q.puml', '/ws/p.puml'),
        asked('common.puml', '/ws/q.puml', '/ws/common.puml'),
        asked('x.puml', '/ws/common.puml', '/ws/x.puml'),
        asked('common.puml', '/ws/p.puml', '/ws/common.puml')
      ),
      []
    );
    expect(shape(tree)).toEqual([
      ['p.puml', [['q.puml', [['p.puml', 'cycle'], ['common.puml', [['x.puml']]]]], ['common.puml', 'again']]],
    ]);
  });

  it('opens up no failed request, and says what an earlier drawing read for one that found nothing', () => {
    const missing = asked('gone.puml', null);
    const refused = asked('link.puml', null, undefined, { state: 'refused', looked: ['/ws/link.puml'] });
    const tree = dependencyTree(log(missing, refused), [], (request) =>
      request === missing ? '/ws/gone.puml' : '/ws/never.puml'
    );
    expect(shape(tree)).toEqual([['gone.puml', { readBefore: '/ws/gone.puml' }], ['link.puml']]);
  });

  it('gives a request of the diagram the lines written as it asked, each line once', () => {
    const source = [
      '!include common.puml',
      '!theme mine from themes',
      '!include common.puml',
      '!includesub common.puml!PART',
    ].join('\n');
    const tree = dependencyTree(
      log(
        asked('common.puml', null, '/ws/common.puml'),
        asked('themes/puml-theme-mine.puml', null, '/ws/themes/puml-theme-mine.puml', { kind: 'theme' }),
        asked('common.puml', null, '/ws/common.puml', { kind: 'includesub' })
      ),
      includeDirectives(source)
    );
    expect(shape(tree)).toEqual([
      ['common.puml', { lines: [0, 2] }],
      ['themes/puml-theme-mine.puml', { lines: [1] }],
      ['common.puml', 'again', { lines: [3] }],
    ]);
  });

  it('gives no line to a request no line is written as, nor to one of a file', () => {
    // The include written in a theme asks from where the theme was asked from.
    const source = '!theme mine from themes';
    const tree = dependencyTree(
      log(
        asked('themes/puml-theme-mine.puml', null, '/ws/themes/puml-theme-mine.puml', { kind: 'theme' }),
        asked('inner.puml', null, '/ws/themes/inner.puml'),
        asked('dyn.iuml', null, '/ws/dyn.iuml')
      ),
      includeDirectives(`${source}\n!$name = "dyn"\n!include $name.iuml`)
    );
    expect(shape(tree)).toEqual([
      ['themes/puml-theme-mine.puml', { lines: [0] }],
      ['inner.puml'],
      ['dyn.iuml'],
      { lines: [[2, '$name.iuml', 'worked-out']] },
    ]);
  });

  it('matches a request the engine did not give the operation of by its path', () => {
    const tree = dependencyTree(log(asked('a.puml', null, '/ws/a.puml', { kind: undefined })), includeDirectives('!include a.puml'));
    expect(shape(tree)).toEqual([['a.puml', { lines: [0] }]]);
  });

  it('lists the include lines no request matches, with why', () => {
    const source = [
      '!include read.puml',
      '!include not-asked.puml',
      '!procedure $p()',
      '!include in-body.puml',
      '!endprocedure',
      '!include $f.puml',
      '!includesub read.puml!PART',
    ].join('\n');
    const tree = dependencyTree(log(asked('read.puml', null, '/ws/read.puml')), includeDirectives(source));
    expect(shape(tree)).toEqual([
      ['read.puml', { lines: [0] }],
      {
        lines: [
          [1, 'not-asked.puml', 'not-asked'],
          [3, 'in-body.puml', 'in-body'],
          [5, '$f.puml', 'worked-out'],
          [6, 'read.puml', 'not-asked'],
        ],
      },
    ]);
  });

  it('lists the files of the bundled libraries read, apart', () => {
    const tree = dependencyTree(
      {
        requests: [],
        libraries: [
          { library: 'c4', key: 'c4_container', found: true },
          { library: 'c4', key: 'nope', found: false },
        ],
      },
      []
    );
    expect(shape(tree)).toEqual([{ libraries: ['c4/c4_container', 'c4/nope'] }]);
  });

  it('counts the requests past the most shown under one file, without listing them elsewhere', () => {
    const tree = dependencyTree(
      log(
        asked('a.puml', null, '/ws/a.puml'),
        asked('b.puml', null, '/ws/b.puml'),
        asked('c.puml', null, '/ws/c.puml'),
        asked('d.puml', '/ws/c.puml', '/ws/d.puml')
      ),
      [],
      undefined,
      2
    );
    expect(shape(tree)).toEqual([['a.puml'], ['b.puml'], { more: 1 }]);
  });

  it('keeps a request asked from a file no request delivered, at the top', () => {
    const stray = asked('a.puml', '/elsewhere/x.puml', undefined, { state: 'outside' });
    const tree = dependencyTree(log(asked('b.puml', null, '/ws/b.puml'), stray), []);
    expect(shape(tree)).toEqual([['b.puml'], ['a.puml']]);
    expect((tree[1] as RequestNode).request).toBe(stray);
  });
});
