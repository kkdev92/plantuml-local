import { describe, expect, it, vi } from 'vitest';

import {
  choosePalette,
  contrast,
  labelContrast,
  MIN_TEXT_CONTRAST,
  probeSource,
  themeLines,
  ThemePalettes,
} from '../../src/render/palette';

/** What the engine draws for a probe: its label, and a background if the theme paints one. */
function probeSvg(label: string, background?: string): string {
  const style = background === undefined ? '' : ` style="background-color:${background};"`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg"${style} viewBox="0 0 10 10">` +
    `<text x="1" y="2" font-size="12" fill="${label}" xml:space="preserve">plantumlLocalProbe</text></svg>`
  );
}

describe('themeLines', () => {
  it('collects the !theme lines, trimmed and in order', () => {
    const source = [
      '@startuml',
      '!theme cerulean',
      '  !theme plain',
      '\t!theme\tcyborg',
      'Alice -> Bob',
      '@enduml',
    ].join('\r\n');

    expect(themeLines(source)).toEqual(['!theme cerulean', '!theme plain', '!theme\tcyborg']);
  });

  it('ignores lines that are not the directive', () => {
    const source = [
      "' !theme cerulean",
      'Alice -> Bob : !theme plain',
      '!theme',
      '!themes plain',
      '!THEME plain',
    ].join('\n');

    expect(themeLines(source)).toEqual([]);
  });
});

describe('probeSource', () => {
  it('wraps the lines in a diagram with one message', () => {
    expect(probeSource(['!theme a', '!theme b'])).toBe(
      '@startuml\n!theme a\n!theme b\nAlice -> Bob : plantumlLocalProbe\n@enduml'
    );
  });
});

describe('contrast', () => {
  it('follows the WCAG ratio', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#777777')).toBe(1);
    // cerulean's text on the dark backdrop, as measured on the engine.
    expect(contrast('#343A40', '#1b1b1b')).toBeCloseTo(1.5, 1);
  });
});

describe('labelContrast', () => {
  it('measures the label against the backdrop of the palette it was drawn in', () => {
    expect(labelContrast(probeSvg('#000000'), false)).toBeCloseTo(21, 5);
    expect(labelContrast(probeSvg('#000000'), true)).toBeLessThan(1.5);
  });

  it('measures against the background the diagram paints itself', () => {
    expect(labelContrast(probeSvg('#FFFFFF', '#000000'), false)).toBeCloseTo(21, 5);
    expect(labelContrast(probeSvg('#FFFFFF', '#000000'), true)).toBeCloseTo(21, 5);
  });

  it('treats a transparent painted background as none', () => {
    expect(labelContrast(probeSvg('#FFFFFF', '#00000000'), false)).toBe(1);
  });

  it('reads a label colour with an alpha channel', () => {
    expect(labelContrast(probeSvg('#000000FF'), false)).toBeCloseTo(21, 5);
  });

  it('gives nothing when the label is missing (the engine drew an error)', () => {
    expect(labelContrast('<svg><text fill="#33FF02">Cannot load theme</text></svg>', false)).toBe(
      undefined
    );
  });
});

describe('choosePalette', () => {
  it('keeps the palette asked for when its text can be read', () => {
    expect(choosePalette(true, { light: 21, dark: MIN_TEXT_CONTRAST })).toBe(true);
    expect(choosePalette(false, { light: MIN_TEXT_CONTRAST, dark: 21 })).toBe(false);
  });

  it('switches when text is hard to read in the palette asked for and easier in the other', () => {
    expect(choosePalette(true, { light: 21, dark: 1.2 })).toBe(false);
    expect(choosePalette(false, { light: 1, dark: 17 })).toBe(true);
    expect(choosePalette(true, { light: 3, dark: 2 })).toBe(false);
  });

  it('does not switch when the other palette is no better', () => {
    expect(choosePalette(true, { light: 2.3, dark: 2.3 })).toBe(true);
    expect(choosePalette(false, { light: 2, dark: 1.5 })).toBe(false);
  });
});

describe('ThemePalettes', () => {
  /** A stand-in engine: each theme's probe label and painted background. */
  function engine() {
    return vi.fn((source: string, _dark: boolean): Promise<string> => {
      if (source.includes('!theme broken')) {
        return Promise.reject(new Error('Rendering timed out'));
      }
      if (source.includes('!theme missing')) {
        return Promise.resolve('<svg><text fill="#33FF02">Cannot load theme missing</text></svg>');
      }
      if (source.includes('!theme painted')) {
        return Promise.resolve(probeSvg('#D9D3D0', '#003153'));
      }
      if (source.includes('!theme for-dark-page')) {
        return Promise.resolve(probeSvg('#FFFFFF'));
      }
      return Promise.resolve(probeSvg('#000000'));
    });
  }

  const diagram = (...lines: string[]): string =>
    ['@startuml', ...lines, 'Alice -> Bob : hi', '@enduml'].join('\n');

  it('keeps the palette asked for, without rendering, when no theme is picked', async () => {
    const render = engine();
    const palettes = new ThemePalettes(render);

    expect(await palettes.resolve(diagram(), true)).toBe(true);
    expect(await palettes.resolve(diagram(), false)).toBe(false);
    expect(render).not.toHaveBeenCalled();
  });

  it('draws a theme made for a white page in the light palette', async () => {
    const render = engine();
    const palettes = new ThemePalettes(render);

    expect(await palettes.resolve(diagram('!theme for-white-page'), true)).toBe(false);
    expect(await palettes.resolve(diagram('!theme for-white-page'), false)).toBe(false);
  });

  it('draws a diagram with the Azure icons in the light palette, without measuring', async () => {
    const render = engine();
    const palettes = new ThemePalettes(render);

    for (const include of [
      '!include <azure/AzureCommon>',
      '  !include_once <azure/Compute/AzureFunction>',
      '!include<azure/AzureCommon>',
    ]) {
      expect(await palettes.resolve(diagram(include), true)).toBe(false);
      expect(await palettes.resolve(diagram(include), false)).toBe(false);
    }
    // Not an include the engine reads: a comment, a label, a capitalised directive.
    for (const line of [
      "' !include <azure/AzureCommon>",
      'note: !include <azure/AzureCommon>',
      '!INCLUDE <azure/AzureCommon>',
    ]) {
      expect(await palettes.resolve(diagram(line), true)).toBe(true);
    }
    expect(render).not.toHaveBeenCalled();
  });

  it('draws a theme made for a dark page in the dark palette', async () => {
    const palettes = new ThemePalettes(engine());

    expect(await palettes.resolve(diagram('!theme for-dark-page'), false)).toBe(true);
    expect(await palettes.resolve(diagram('!theme for-dark-page'), true)).toBe(true);
  });

  it('keeps the palette asked for when the theme paints its own background', async () => {
    const palettes = new ThemePalettes(engine());

    expect(await palettes.resolve(diagram('!theme painted'), true)).toBe(true);
    expect(await palettes.resolve(diagram('!theme painted'), false)).toBe(false);
  });

  it('keeps the palette asked for when the engine cannot load the theme', async () => {
    const palettes = new ThemePalettes(engine());

    expect(await palettes.resolve(diagram('!theme missing'), true)).toBe(true);
    expect(await palettes.resolve(diagram('!theme missing'), false)).toBe(false);
  });

  it('measures each set of theme lines once, in both palettes, with all of the lines', async () => {
    const render = engine();
    const palettes = new ThemePalettes(render);
    const source = diagram('!theme cerulean', 'Alice -> Carol', '  !theme plain');

    await Promise.all([palettes.resolve(source, true), palettes.resolve(source, false)]);
    await palettes.resolve(`${source}\n' edited`, true);

    expect(render.mock.calls).toEqual([
      [probeSource(['!theme cerulean', '!theme plain']), false],
      [probeSource(['!theme cerulean', '!theme plain']), true],
    ]);
  });

  it('measures again after a render that did not finish', async () => {
    const render = engine();
    const palettes = new ThemePalettes(render);

    expect(await palettes.resolve(diagram('!theme broken'), true)).toBe(true);
    expect(await palettes.resolve(diagram('!theme broken'), true)).toBe(true);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('forgets the oldest measurement once many sets of lines have been seen', async () => {
    const render = engine();
    const palettes = new ThemePalettes(render);

    for (let index = 0; index <= 64; index += 1) {
      await palettes.resolve(diagram(`!theme t${String(index)}`), false);
    }
    expect(render).toHaveBeenCalledTimes(130);

    // The newest are still known; the first has to be measured again.
    await palettes.resolve(diagram('!theme t64'), false);
    expect(render).toHaveBeenCalledTimes(130);
    await palettes.resolve(diagram('!theme t0'), false);
    expect(render).toHaveBeenCalledTimes(132);
  });
});
