import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { addBackground } from '../../src/export/exporter';
import { recognizeEngineError, recognizeEngineWarnings } from '../../src/render/engine-error';

/**
 * The fixtures are what the bundled engine returned through the render
 * worker (sanitised) for the source named in each test, captured with
 * @plantuml/core 1.2026.8. test/integration/grammar-cases.test.ts checks
 * the same rules against a live engine.
 */
function fixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures/engine-output', `${name}.svg`), 'utf8');
}

describe('recognizeEngineError', () => {
  describe('the located error layout', () => {
    it('reads the message and the line of a syntax error', () => {
      // @startuml / Alice -> Bob / this is not valid ;;; [[[ / @enduml
      expect(recognizeEngineError(fixture('syntax-error'))).toEqual({
        message: 'Syntax Error? (Assumed diagram type: sequence)',
        line: 3,
      });
    });

    it('reads an include the engine could not resolve', () => {
      // @startuml / !include shared.puml / Alice -> Bob / @enduml
      expect(recognizeEngineError(fixture('include-failure'))).toEqual({
        message: 'cannot include shared.puml',
        line: 2,
      });
    });

    it('reads an empty diagram', () => {
      // @startuml / @enduml
      expect(recognizeEngineError(fixture('empty-diagram'))).toEqual({
        message: 'Empty description (Assumed diagram type: sequence)',
        line: 2,
      });
    });

    it('names the library when the error is in one, rather than blaming a line of the source', () => {
      // How the engine words the location of an error inside an included
      // library, e.g. `[From <mylib/broken> (line 1) ]`.
      const inLibrary = fixture('syntax-error').replace(
        '[From textarea (line 3) ]',
        '[From &lt;mylib/broken&gt; (line 1) ]'
      );

      expect(recognizeEngineError(inLibrary)).toEqual({
        message: 'Syntax Error? (Assumed diagram type: sequence) (<mylib/broken>, line 1)',
        line: null,
      });
    });
  });

  describe('the "not supported" layout', () => {
    it('quotes the line the engine did not recognise', () => {
      // A source without @startuml.
      expect(recognizeEngineError(fixture('not-supported'))).toEqual({
        message:
          'Diagram not supported by this release of PlantUML: "Alice -> Bob : no start line" is not recognized',
        line: null,
      });
    });

    it('falls back to the heading when there is no line to quote', () => {
      // An empty source.
      expect(recognizeEngineError(fixture('not-supported-empty'))).toEqual({
        message: 'Diagram not supported by this release of PlantUML',
        line: null,
      });
    });
  });

  describe('the lone-message layout', () => {
    it('recognises unreadable JSON data', () => {
      expect(recognizeEngineError(fixture('json-error'))).toEqual({
        message: 'Your data does not sound like JSON data',
        line: null,
      });
    });

    it('recognises an EBNF syntax error', () => {
      expect(recognizeEngineError(fixture('ebnf-error'))).toEqual({
        message: 'Syntax error!',
        line: null,
      });
    });

    it('needs the engine output as returned: a background added for export is a shape', () => {
      expect(recognizeEngineError(addBackground(fixture('ebnf-error'), false))).toBeNull();
    });
  });

  describe('diagrams', () => {
    it('leaves an ordinary diagram alone', () => {
      expect(recognizeEngineError(fixture('sequence'))).toBeNull();
    });

    it('leaves a diagram the engine drew with a warning alone', () => {
      // Deprecated syntax: the engine draws the diagram under a warning banner.
      expect(recognizeEngineError(fixture('warning'))).toBeNull();
    });

    it('is not fooled by labels that read like the error layout', () => {
      // participant "PlantUML version 1", message "[From textarea (line 3) ]".
      expect(recognizeEngineError(fixture('label-mimics-error'))).toBeNull();
    });

    it('is not fooled by a message that says "Syntax error!"', () => {
      expect(recognizeEngineError(fixture('message-syntax-error'))).toBeNull();
    });

    it('is not fooled by JSON data that contains the engine\'s wording', () => {
      expect(recognizeEngineError(fixture('json-with-phrase'))).toBeNull();
    });

    it('needs the location line under the banner, not just the banner', () => {
      const bannerOnly = fixture('syntax-error').replace('[From textarea (line 3) ]', 'Release notes');
      expect(recognizeEngineError(bannerOnly)).toBeNull();
    });

    it('needs the "not supported" explanation, not just its heading', () => {
      const headingOnly = fixture('not-supported').replace(
        'Sorry, but the following directive ',
        'Some other sentence '
      );
      expect(recognizeEngineError(headingOnly)).toBeNull();
    });

    it('returns null for input that is not an engine drawing at all', () => {
      expect(recognizeEngineError('')).toBeNull();
      expect(recognizeEngineError('<svg xmlns="http://www.w3.org/2000/svg"/>')).toBeNull();
    });
  });
});

describe('recognizeEngineWarnings', () => {
  it('reads the banner the engine draws above a diagram it accepted with warnings', () => {
    expect(recognizeEngineWarnings(fixture('warning'))).toEqual([
      "This syntax is deprecated, you must add <<#pink>> at the end of the line, after the ';'",
    ]);
  });

  it('reads it in the dark palette too, where the banner has other colours', () => {
    // Measured with the bundled engine: fill #774400, stroke #AA5500, white text.
    const dark = fixture('warning').replace('fill="#FFFFCC" stroke="#FFDD88"', 'fill="#774400" stroke="#AA5500"');
    expect(recognizeEngineWarnings(dark)).toHaveLength(1);
  });

  it('finds none in a diagram without the banner, or in an error', () => {
    expect(recognizeEngineWarnings(fixture('sequence'))).toEqual([]);
    expect(recognizeEngineWarnings(fixture('syntax-error'))).toEqual([]);
  });
});
