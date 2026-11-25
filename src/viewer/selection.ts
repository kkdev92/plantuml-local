import { lineBreaks, splitLines } from '../core/lines';
import { findFileDiagrams, type PlantUmlBlock } from '../export/blocks';

export interface TextChange {
  rangeOffset: number;
  rangeLength: number;
  text: string;
}

type Anchor =
  | { kind: 'id'; name: string }
  | { kind: 'line'; offset: number; raw: string }
  | { kind: 'document' };

interface Visit {
  anchor: Anchor;
  key: string;
  index: number;
}

/** Each visited opening line belongs to this panel and this document lifetime. */
export class ViewerSelection {
  text = '';
  diagrams: PlantUmlBlock[] = [];
  revision = 0;
  current: Visit | undefined;
  waiting = true;
  private visits: Visit[] = [];
  private offsets: number[] = [];
  private nextKey = 0;

  constructor(private readonly fileName: string) {}

  /** Replay changes in delivery order, then verify every surviving anchor against the parser. */
  read(text: string, changes?: readonly TextChange[], replaced = false): void {
    if (text === this.text && changes === undefined && !replaced) {
      return;
    }
    let replay = this.text;
    let verified = !replaced && changes !== undefined;
    if (verified && changes !== undefined) {
      for (const { rangeOffset: start, rangeLength: length, text: inserted } of changes) {
        const end = start + length;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0 || end > replay.length) {
          verified = false;
          break;
        }
        for (const visit of this.visits) {
          const a = visit.anchor;
          if (a.kind !== 'line' || visit.index < 0) {
            continue;
          }
          if (end <= a.offset) {
            a.offset += inserted.length - length;
          } else if (start < a.offset + a.raw.length) {
            visit.index = -1;
          }
        }
        replay = replay.slice(0, start) + inserted + replay.slice(end);
      }
    }
    verified &&= replay === text;
    this.text = text;
    this.revision++;
    this.diagrams = findFileDiagrams(text, this.fileName);
    const breaks = lineBreaks(text);
    let offset = 0;
    this.offsets = splitLines(text).map((line, i) => {
      const result = offset;
      offset += line.length + (breaks[i]?.length ?? 0);
      return result;
    });
    this.visits = this.visits.filter((visit) => {
      const a = visit.anchor;
      if (a.kind === 'id') {
        visit.index = this.uniqueId(a.name);
      } else if (a.kind === 'document') {
        visit.index = !replaced && this.diagrams[0]?.hasOpeningLine === false ? 0 : -1;
      } else if (verified && visit.index >= 0) {
        visit.index = this.diagrams.findIndex(d => d.hasOpeningLine === true && this.offsets[d.openLine] === a.offset && this.line(d) === a.raw);
      } else {
        visit.index = -1;
      }
      return visit.index >= 0;
    });
    if (this.current && !this.visits.includes(this.current)) {
      this.current = undefined;
    }
    if (this.waiting && this.diagrams.length) {
      this.choose(0);
    }
  }

  private line(d: PlantUmlBlock): string {
    return this.text.slice(this.offsets[d.openLine], this.offsets[d.openLine + 1] ?? this.text.length);
  }

  private uniqueId(name: string): number {
    const matches = this.diagrams.filter(d => d.nameBasis === 'explicit-id' && d.name === name);
    return matches.length === 1 ? this.diagrams.indexOf(matches[0]!) : -1;
  }

  choose(index: number): void {
    this.waiting = false;
    const d = this.diagrams[index];
    if (!d) {
      this.current = undefined;
      return;
    }
    let visit = this.visits.find(candidate => candidate.index === index);
    const unique = d.name !== null && d.nameBasis === 'explicit-id' && this.uniqueId(d.name) === index;
    if (visit && unique && d.name !== null) {
      // Explicitly choosing a previously ambiguous ID can now follow that ID.
      visit.anchor = { kind: 'id', name: d.name };
    }
    if (!visit) {
      let anchor: Anchor = { kind: 'document' };
      if (unique && d.name !== null) {
        anchor = { kind: 'id', name: d.name };
      } else if (d.hasOpeningLine === true) {
        anchor = { kind: 'line', offset: this.offsets[d.openLine]!, raw: this.line(d) };
      }
      visit = { anchor, key: String(++this.nextKey), index };
    }
    this.visits = [...this.visits.filter(v => v !== visit).slice(-199), visit];
    this.current = visit;
  }

  saved(): { name: string | null; nameBasis: 'explicit-id' | 'single-file-name' | null } {
    const d = this.current && this.diagrams[this.current.index];
    if (d && (this.current?.anchor.kind === 'id' || d.nameBasis === 'single-file-name')) {
      return { name: d.name, nameBasis: d.nameBasis === 'explicit-id' ? 'explicit-id' : 'single-file-name' };
    }
    return { name: null, nameBasis: null };
  }

  restore(state: { name?: unknown; nameBasis?: unknown; stateVersion?: unknown }): void {
    const name = state.name;
    const legacy = !('stateVersion' in state) && !('nameBasis' in state);
    const basis = legacy ? (name === this.fileName ? 'single-file-name' : 'explicit-id') : state.nameBasis;
    let index = -1;
    if ((legacy || state.stateVersion === 2) && typeof name === 'string') {
      if (basis === 'explicit-id') {
        index = this.uniqueId(name);
      }
      if (basis === 'single-file-name' && name === this.fileName && this.diagrams[0]?.nameBasis === basis) {
        index = 0;
      }
    }
    this.choose(index);
  }
}
