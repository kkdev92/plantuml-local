/**
 * Reads the title the engine drew on a diagram: what the `.puml` preview
 * tells a screen reader the diagram is called.
 *
 * The engine draws a diagram's `title` into a `<g class="title">` group, as
 * text with its markup applied — `title <u>Simple</u> flow` draws "Simple"
 * and " flow" — and a text for each line of a title of several lines. So what
 * is read is what the diagram shows: nothing of the source that the drawing
 * leaves out comes back. test/integration/worker.test.ts draws a title in
 * each diagram type with the bundled engine, and an engine update that draws
 * titles otherwise fails there.
 */

import { decode } from './engine-error';

/** A tag that opens or closes a group, and the slash of one that closes itself. */
const GROUP_TAG = /<(\/?)g\b[^>]*?(\/?)>/g;
const TEXT = /<text\b([^>]*)>([^<]*)<\/text>/g;
const Y = /\by="([^"]*)"/;

/** The title the engine drew in `svg`, on one line, or null when it drew none. */
export function drawnTitle(svg: string): string | null {
  const start = svg.indexOf('<g class="title"');
  if (start === -1) {
    return null;
  }
  // The group, up to the tag that closes it.
  let end = svg.length;
  let depth = 0;
  for (const tag of svg.slice(start).matchAll(GROUP_TAG)) {
    if (tag[1] === '/') {
      depth -= 1;
    } else if (tag[2] !== '/') {
      depth += 1;
    }
    if (depth === 0) {
      end = start + tag.index + tag[0].length;
      break;
    }
  }

  let title = '';
  let line: string | undefined;
  for (const [, attributes = '', content = ''] of svg.slice(start, end).matchAll(TEXT)) {
    const y = Y.exec(attributes)?.[1];
    // A text lower down starts the next line of the title.
    if (line !== undefined && y !== line) {
      title += ' ';
    }
    line = y;
    title += decode(content);
  }
  title = title.replace(/\s+/g, ' ').trim();
  return title === '' ? null : title;
}
