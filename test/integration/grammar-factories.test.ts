import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PlantUmlEngine } from '../../src/core/types';
import type * as EngineModule from '../../src/worker/engine';
import { caseGroups } from '../unit/grammar/cases';
import checklist from '../unit/grammar/checklist.json';

/**
 * A grammar case lists the commands it exercises (`covers`), and the
 * checklist test counts on that list. This holds the list to the engine:
 * the commands must belong to the factory that accepted the case. Inside
 * `@startuml` the engine tries its factories in turn and keeps the first
 * that reads every line, so a case written as an activity diagram could be
 * read as a description diagram and still render without an error.
 *
 * The engine runs in this process rather than in the render worker: its
 * log names the factories it tries, and has to be read render by render.
 */

const distDir = join(__dirname, '../../dist');

/**
 * The factories the engine tries for each `@start` type, in its order
 * (PSystemBuilder2 upstream). Most log their name when tried; the others
 * are named by position here, and the positions are checked against the
 * names that are logged.
 */
const ORDER: Record<string, readonly string[]> = {
  uml: [
    'SequenceDiagramFactory',
    'ClassDiagramFactory',
    'ActivityDiagramFactory',
    'DescriptionDiagramFactory',
    'StateDiagramFactory',
    'ActivityDiagramFactory3',
    'PSystemVersionFactory',
    'TimingDiagramFactory',
  ],
  gantt: ['GanttDiagramFactory'],
  project: ['GanttDiagramFactory'],
  mindmap: ['MindMapDiagramFactory'],
  wbs: ['WBSDiagramFactory'],
  nwdiag: ['NwDiagramFactory'],
  packetdiag: ['PacketDiagramFactory'],
  creole: ['PSystemCreoleFactory'],
  chart: ['ChartDiagramFactory'],
  json: ['JsonDiagramFactory'],
  yaml: ['YamlDiagramFactory'],
  ebnf: ['PSystemEbnfFactory'],
  regex: ['PSystemRegexFactory'],
};

/**
 * For a source of ten lines or more, the engine first tries the factory
 * that accepted the previous diagram, without logging it. A short diagram
 * that no factory accepts clears that, so each case is read in the plain
 * order.
 */
const RESET = '@startuml\n@@@\n@enduml';

const commandsOf = new Map(checklist.factories.map((f) => [f.name, new Set(f.commands)]));

let engine: PlantUmlEngine;
let bundleDir: string;

beforeAll(async () => {
  // The loader imports the engine through `new Function('return import()')`,
  // which Vitest's module runner cannot serve. Bundled and loaded with
  // Node's own require, it runs as it does in the worker.
  const bundle = await build({
    entryPoints: [join(__dirname, '../../src/worker/engine.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    logLevel: 'warning',
  });
  bundleDir = mkdtempSync(join(tmpdir(), 'plantuml-local-engine-'));
  const file = join(bundleDir, 'engine.cjs');
  writeFileSync(file, bundle.outputFiles[0]?.text ?? '');
  const { loadEngine } = createRequire(__filename)(file) as typeof EngineModule;
  ({ engine } = await loadEngine(join(distDir, 'engine'), join(distDir, 'stdlib')));
});

afterAll(() => {
  rmSync(bundleDir, { recursive: true, force: true });
});

async function engineLog(source: string): Promise<string[]> {
  const log: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]): void => {
    log.push(args.map(String).join(' '));
  };
  try {
    await new Promise<void>((resolve) => {
      engine.renderToString(
        source.split('\n'),
        () => resolve(),
        () => resolve(),
        { dark: false }
      );
    });
  } finally {
    console.log = original;
  }
  return log;
}

interface Reading {
  /** The factories tried, in order; unnamed ones named by position. */
  tried: string[];
  /** The names the engine logged for them, where it logged one. */
  logged: (string | undefined)[];
  /** Index in `tried` of the factory that accepted the source, or -1. */
  accepted: number;
  order: readonly string[];
}

async function read(source: string): Promise<Reading> {
  await engineLog(RESET);
  const log = await engineLog(source);
  const logged: (string | undefined)[] = [];
  let accepted = -1;
  for (const [i, line] of log.entries()) {
    if (line.includes('[PSystemBuilder2] trying ')) {
      // The factory's own "createSystem" line follows, if it logs one.
      logged.push(/\[(\w+)\] createSystem/.exec(log[i + 1] ?? '')?.[1]);
    } else if (line.includes('[PSystemBuilder2] ok!')) {
      accepted = logged.length - 1;
    }
  }
  const type = /^\s*[@\\]start(\w+)/m.exec(source)?.[1]?.toLowerCase() ?? '';
  const order = ORDER[type] ?? [];
  return { tried: logged.map((name, i) => name ?? order[i] ?? '?'), logged, accepted, order };
}

describe('grammar cases are read by the factory their commands belong to', () => {
  it('names the factory that accepted a diagram (positive control)', async () => {
    const sequence = await read('@startuml\nAlice -> Bob : hi\n@enduml');
    expect(sequence.tried[sequence.accepted]).toBe('SequenceDiagramFactory');

    // ActivityDiagramFactory3 does not log its name: this is the table.
    const activity = await read('@startuml\nstart\n:a;\nstop\n@enduml');
    expect(activity.tried[activity.accepted]).toBe('ActivityDiagramFactory3');
    // So a case claiming a sequence command for it would fail below.
    expect(commandsOf.get('ActivityDiagramFactory3')?.has('CommandParticipantA')).toBe(false);
    expect(commandsOf.get('SequenceDiagramFactory')?.has('CommandParticipantA')).toBe(true);
  });

  for (const [file, cases] of Object.entries(caseGroups)) {
    for (const c of cases) {
      if (c.render !== undefined && c.render !== 'ok') continue;
      it(`${file}: ${c.name}`, async () => {
        const { tried, logged, accepted, order } = await read(c.source);

        // The table still matches the engine wherever the engine names a factory.
        for (const [i, name] of logged.entries()) {
          if (name !== undefined) expect(order[i], `factory ${i + 1} of ${order.join(', ')}`).toBe(name);
        }
        expect(accepted, `no factory accepted it; tried ${tried.join(', ')}`).toBeGreaterThanOrEqual(0);

        const factory = tried[accepted] ?? '?';
        const commands = commandsOf.get(factory) ?? new Set<string>();
        const claimed = c.covers.filter((id) => id.startsWith('command:')).map((id) => id.slice('command:'.length));
        expect(
          claimed.filter((command) => !commands.has(command)),
          `commands ${factory} does not have`
        ).toEqual([]);
        for (const id of c.covers.filter((id) => id.startsWith('factory:'))) {
          expect(factory).toBe(id.slice('factory:'.length));
        }
      });
    }
  }
});
