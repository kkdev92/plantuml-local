import { describe, expect, it } from 'vitest';

import { diagramKind, inBodies } from '../../src/language/diagram-kind';
import { protect } from '../../src/language/protected';

const kind = (lines: readonly string[], skip?: number): string | null => diagramKind(protect(lines, false), skip);

describe('diagramKind', () => {
  it.each([
    'participant A',
    'create participant A',
    'activate A',
    'deactivate A',
    'destroy A',
    'autonumber',
    'alt x',
    'opt x',
    'loop 10 times',
    'par',
    'critical',
    'ref over A : x',
    'note over A : x',
    '== Section ==',
    'return done',
    'box "Box" #LightBlue',
    'hnote over A : x',
    'rnote over A : x',
    '[-> A : in',
    'A ->] : out',
    'PARTICIPANT A',
    'Alt x',
  ])('takes %s for a sequence diagram', (marker) => {
    expect(kind(['A -> B', marker])).toBe('sequence');
  });

  it.each([
    'start',
    'stop',
    ':action;',
    'if (x) then (yes)',
    'while (x)',
    'repeat',
    'repeat while (x)',
    'fork',
    'fork again',
    'split',
    'switch (x)',
    '|Lane|',
    '|#pink|Lane|',
    'detach',
    'kill',
    'Start',
    'IF (x) THEN (y)',
  ])('takes %s for an activity diagram', (marker) => {
    expect(kind([marker])).toBe('activity');
    // Among lines both types read.
    expect(kind(['note right : x', marker, 'end'])).toBe('activity');
  });

  it.each([
    'actor A',
    'A -> B : m',
    'A ->> B',
    'A ->x B',
    'A -> B ++',
    '...',
    '|||',
    'partition P {',
    'end',
    'else',
    'group g',
    'title Overview',
    'skinparam monochrome true',
  ])('does not decide on %s, which other diagram types read too', (line) => {
    expect(kind([line])).toBeNull();
  });

  it('does not take a relation to an element named like a marker for one', () => {
    for (const line of ['loop --> idle', 'participant -> x', 'box ..> x', 'start --> running', 'fork -> x', 'return <-- x']) {
      expect(kind([line]), line).toBeNull();
    }
  });

  it('does not read markers in comments, quoted text or notes', () => {
    expect(kind(["' participant A", 'A -> B'])).toBeNull();
    expect(kind(['note left', 'alt x', 'end note', 'A -> B'])).toBeNull();
    expect(kind(['A -> B : start'])).toBeNull();
    expect(kind(['rectangle "start"'])).toBeNull();
  });

  it('does not read the members of a class body, but reads an activity partition', () => {
    expect(kind(['class Meeting {', '  loop count', '  start', '  == Fields ==', '}'])).toBeNull();
    expect(kind(['partition Checkout {', '  :pay;', '}'])).toBe('activity');
  });

  it('decides on nothing when markers of both types are present', () => {
    expect(kind(['participant A', 'start'])).toBeNull();
  });

  it('leaves out the line being typed', () => {
    expect(kind(['A -> B', 'participant X'], 1)).toBeNull();
    expect(kind(['participant A', 'participant X'], 1)).toBe('sequence');
  });
});

describe('inBodies', () => {
  it('marks the lines of a { … } body, but not those of an activity partition', () => {
    const lines = ['class C {', 'x', '}', 'partition P {', 'y', '}', 'skinparam sequence {', 'z', '}', 'w'];

    expect(inBodies(protect(lines, false))).toEqual([false, true, true, false, false, false, false, true, true, false]);
  });

  it('counts braces only in code: a quoted or noted brace opens nothing', () => {
    const lines = ['A -> B : "{"', 'note left : {', 'x'];

    expect(inBodies(protect(lines, false))).toEqual([false, false, false]);
  });
});
