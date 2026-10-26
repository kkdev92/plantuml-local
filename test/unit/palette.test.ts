import { describe, expect, it, vi } from 'vitest';

import {
  choosePalette,
  DARK_LINK,
  drawReadable,
  contrast,
  labelContrast,
  lightenLinks,
  MIN_TEXT_CONTRAST,
  paletteLines,
  probeSource,
  themeLines,
  ThemePalettes,
  weakestTextContrast,
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

  it('reads the lines of a file that ends them with a lone CR', () => {
    const source = ['@startuml', '!theme cerulean', '!theme plain', 'Alice -> Bob', '@enduml'].join(String.fromCharCode(13));

    expect(themeLines(source)).toEqual(['!theme cerulean', '!theme plain']);
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

  it('measures a diagram with the Azure icons that picks a theme, like any other', async () => {
    const render = engine();
    const palettes = new ThemePalettes(render);

    // The theme colours the text, the same in either palette.
    expect(await palettes.resolve(diagram('!theme for-dark-page', '!include <azure/AzureCommon>'), false)).toBe(true);
    expect(render).toHaveBeenCalled();
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

describe('paletteLines', () => {
  it('takes the theme lines of the included files where the first local include is', () => {
    const source = ['@startuml', '!theme a', '!include styles.puml', '!theme c', 'A -> B', '@enduml'].join('\n');
    expect(paletteLines(source, { themes: ['!theme b'], azure: false })).toEqual(['!theme a', '!theme b', '!theme c']);
  });

  it('keeps the diagram’s own lines when the files it included set no theme', () => {
    expect(paletteLines('@startuml\n!theme a\n@enduml')).toEqual(['!theme a']);
    expect(paletteLines('@startuml\n!theme a\n@enduml', { themes: [], azure: true })).toEqual(['!theme a']);
  });

  it('puts the lines of a theme read from a folder in place of the line that names it', () => {
    const source = ['@startuml', '!theme local from themes', '!theme b from <lib/themes>', 'A -> B', '@enduml'].join('\n');
    expect(paletteLines(source)).toEqual(['!theme local from themes', '!theme b from <lib/themes>']);
    expect(paletteLines(source, { themes: ['skinparam backgroundColor #FEDCBA'], azure: false })).toEqual([
      'skinparam backgroundColor #FEDCBA',
      '!theme b from <lib/themes>',
    ]);
  });

  it('does the same for a theme an included file reads from a folder', () => {
    const included = { themes: ['!theme local from themes', 'skinparam backgroundColor #FEDCBA'], azure: false };
    expect(paletteLines('@startuml\n!include style.iuml\n@enduml', included)).toEqual([
      'skinparam backgroundColor #FEDCBA',
    ]);
  });
});

describe('ThemePalettes and what a diagram included', () => {
  const render = (source: string): Promise<string> =>
    Promise.resolve(probeSvg(source.includes('!theme for-dark-page') ? '#FFFFFF' : '#000000'));
  const diagram = '@startuml\n!include styles.puml\nAlice -> Bob : hi\n@enduml';

  it('measures the theme an included file picks', async () => {
    const palettes = new ThemePalettes(render);
    expect(await palettes.resolve(diagram, true)).toBe(true);
    expect(await palettes.resolve(diagram, true, { themes: ['!theme for-white-page'], azure: false })).toBe(false);
    expect(await palettes.resolve(diagram, false, { themes: ['!theme for-dark-page'], azure: false })).toBe(true);
  });

  it('draws in the light palette a diagram whose included file brings the Azure icons and no theme', async () => {
    const palettes = new ThemePalettes(render);
    expect(await palettes.resolve(diagram, true, { themes: [], azure: true })).toBe(false);
  });
});

describe('drawReadable', () => {
  const drawn = (palette: boolean, includedStyle?: { themes: string[]; azure: boolean }) => ({
    svg: String(palette),
    failedIncludes: new Map<string, string>(),
    dependencies: [],
    ...(includedStyle === undefined ? {} : { includedStyle }),
  });

  it('draws once when nothing it included bears on the palette', async () => {
    const draw = vi.fn((palette: boolean) => Promise.resolve(drawn(palette)));
    const resolve = vi.fn((_source: string, dark: boolean) => Promise.resolve(dark));
    expect(await drawReadable('src', true, resolve, draw)).toMatchObject({ palette: true, result: { svg: 'true' } });
    expect(draw).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('draws once more in the other palette when what it included turns the choice, and takes that', async () => {
    const style = { themes: ['!theme for-white-page'], azure: false };
    const draw = vi.fn((palette: boolean) => Promise.resolve(drawn(palette, style)));
    const resolve = vi.fn((_source: string, dark: boolean, included?: unknown) =>
      Promise.resolve(included === undefined ? dark : false)
    );
    expect(await drawReadable('src', true, resolve, draw)).toMatchObject({ palette: false, result: { svg: 'false' } });
    expect(draw.mock.calls.map((call) => call[0])).toEqual([true, false]);
    expect(resolve).toHaveBeenLastCalledWith('src', true, style);
  });

  it('keeps the first drawing when the choice holds', async () => {
    const style = { themes: ['!theme cerulean'], azure: false };
    const draw = vi.fn((palette: boolean) => Promise.resolve(drawn(palette, style)));
    const resolve = vi.fn((_source: string, dark: boolean) => Promise.resolve(dark));
    expect(await drawReadable('src', false, resolve, draw)).toMatchObject({ palette: false });
    expect(draw).toHaveBeenCalledTimes(1);
  });

  /** A participant the diagram paints light, with the palette's text on it. */
  const lightBox = (palette: boolean): string =>
    '<svg viewBox="0 0 100 50"><rect x="7" y="7" width="50" height="30" fill="#DDEEFF"/>' +
    `<text x="12" y="23" font-size="14" fill="${palette ? '#FFFFFF' : '#000000'}">Alice</text></svg>`;
  const asAsked = (_source: string, dark: boolean): Promise<boolean> => Promise.resolve(dark);

  it('takes the light drawing when the colours the diagram sets are hard to read in the dark one', async () => {
    const draw = vi.fn((palette: boolean) => Promise.resolve({ ...drawn(palette), svg: lightBox(palette) }));
    expect(await drawReadable('src', true, asAsked, draw)).toMatchObject({ palette: false, result: { svg: lightBox(false) } });
    expect(draw.mock.calls.map((call) => call[0])).toEqual([true, false]);
  });

  it('keeps the dark drawing when the light one reads no better', async () => {
    const svg = '<svg><text x="1" y="20" font-size="14" fill="#777777">Header</text></svg>';
    const draw = vi.fn((palette: boolean) => Promise.resolve({ ...drawn(palette), svg }));
    // #777777 is 3.9 on the dark backdrop: readable enough not to try the light one.
    expect(await drawReadable('src', true, asAsked, draw)).toMatchObject({ palette: true });
    expect(draw).toHaveBeenCalledTimes(1);

    const grey = '<svg><text x="1" y="20" font-size="14" fill="#333333">Faint</text></svg>';
    const both = vi.fn((palette: boolean) =>
      Promise.resolve({ ...drawn(palette), svg: palette ? grey : grey.replace('#333333', '#EEEEEE') })
    );
    expect(await drawReadable('src', true, asAsked, both)).toMatchObject({ palette: true, result: { svg: grey } });
    expect(both.mock.calls.map((call) => call[0])).toEqual([true, false]);
  });

  it('does not look at a drawing in the light palette', async () => {
    const draw = vi.fn((palette: boolean) => Promise.resolve({ ...drawn(palette), svg: lightBox(!palette) }));
    expect(await drawReadable('src', false, asAsked, draw)).toMatchObject({ palette: false });
    expect(draw).toHaveBeenCalledTimes(1);
  });

  it("lightens the links of a dark drawing, and leaves the light one's", async () => {
    const link = '<svg><text x="1" y="20" fill="#0000FF" text-decoration="underline">docs</text></svg>';
    const draw = (palette: boolean): Promise<ReturnType<typeof drawn>> => Promise.resolve({ ...drawn(palette), svg: link });
    expect((await drawReadable('src', true, asAsked, draw)).result.svg).toBe(link.replace('#0000FF', DARK_LINK));
    expect((await drawReadable('src', false, asAsked, draw)).result.svg).toBe(link);
  });
});

describe('lightenLinks', () => {
  it('recolours the text the engine underlines in its link blue, and nothing else', () => {
    const svg =
      '<svg><text x="1" y="2" font-size="13" fill="#0000FF" text-decoration="underline">link</text>' +
      '<text x="1" y="4" fill="#0000FF">blue</text>' +
      '<text x="1" y="6" fill="#FF0000" text-decoration="underline">red link</text>' +
      '<rect fill="#0000FF" text-decoration="underline"/></svg>';
    expect(lightenLinks(svg)).toBe(svg.replace('fill="#0000FF" text-decoration', `fill="${DARK_LINK}" text-decoration`));
  });

  it('chooses a colour that reads on the dark fills the engine gives elements, notes and warnings', () => {
    for (const fill of ['#1B1B1B', '#222222', '#313139', '#714137', '#774400']) {
      expect(contrast(DARK_LINK, fill), fill).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    }
  });
});

describe('weakestTextContrast', () => {
  const text = (fill: string, x = 12, y = 23, extra = ''): string =>
    `<text x="${String(x)}" y="${String(y)}" font-size="14" fill="${fill}"${extra}>Alice</text>`;

  it('measures a text against the last shape painted under it', () => {
    const svg = `<svg><rect x="0" y="0" width="100" height="50" fill="#DDEEFF"/>${text('#FFFFFF')}</svg>`;
    expect(weakestTextContrast(svg, true)).toBeCloseTo(contrast('#FFFFFF', '#DDEEFF'));
    const over = `<svg><rect x="0" y="0" width="100" height="50" fill="#DDEEFF"/><rect x="5" y="5" width="60" height="30" fill="#222222"/>${text('#FFFFFF')}</svg>`;
    expect(weakestTextContrast(over, true)).toBeCloseTo(contrast('#FFFFFF', '#222222'));
  });

  it('measures a text no shape is under against what the drawing sits on', () => {
    const elsewhere = '<rect x="200" y="200" width="10" height="10" fill="#FFFFFF"/>';
    expect(weakestTextContrast(`<svg>${elsewhere}${text('#FFFFFF')}</svg>`, true)).toBeCloseTo(
      contrast('#FFFFFF', '#1b1b1b')
    );
    expect(weakestTextContrast(`<svg>${text('#000000')}</svg>`, false)).toBeCloseTo(21);
    const painted = `<svg style="background-color:#000000;">${text('#FFFFFF')}</svg>`;
    expect(weakestTextContrast(painted, false)).toBeCloseTo(21);
  });

  it('looks through shapes that paint nothing', () => {
    const clear = '<rect x="0" y="0" width="100" height="50" fill="#00000000"/><rect x="0" y="0" width="100" height="50" fill="none"/>';
    expect(weakestTextContrast(`<svg>${clear}${text('#FFFFFF')}</svg>`, true)).toBeCloseTo(contrast('#FFFFFF', '#1b1b1b'));
  });

  it('finds the shape under a text whatever its kind', () => {
    const shapes = [
      '<ellipse cx="30" cy="20" rx="30" ry="15" fill="#ADD8E6"/>',
      '<circle cx="30" cy="20" r="25" fill="#ADD8E6"/>',
      '<polygon points="0,0 100,0 100,50 0,50 0,0" fill="#ADD8E6"/>',
      '<path d="M0,10 C0,0 50,0 50,0 L100,0 L100,50 A2.5,2.5 0 0 1 97.5,52.5 L0,50 Z" fill="#ADD8E6"/>',
    ];
    for (const shape of shapes) {
      expect(weakestTextContrast(`<svg>${shape}${text('#FFFFFF', 12, 23)}</svg>`, true), shape).toBeCloseTo(
        contrast('#FFFFFF', '#ADD8E6')
      );
    }
  });

  it('finds a text by its middle, whichever way it is anchored', () => {
    const box = '<rect x="40" y="0" width="60" height="50" fill="#DDEEFF"/>';
    // Starting left of the box, but mostly in it.
    expect(weakestTextContrast(`<svg>${box}${text('#FFFFFF', 30, 23)}</svg>`, true)).toBeCloseTo(
      contrast('#FFFFFF', '#DDEEFF')
    );
    expect(
      weakestTextContrast(`<svg>${box}${text('#FFFFFF', 70, 20, ' text-anchor="middle" dominant-baseline="central"')}</svg>`, true)
    ).toBeCloseTo(contrast('#FFFFFF', '#DDEEFF'));
    expect(weakestTextContrast(`<svg>${box}${text('#FFFFFF', 30, 23, ' text-anchor="end"')}</svg>`, true)).toBeCloseTo(
      contrast('#FFFFFF', '#1b1b1b')
    );
  });

  it('gives the weakest text, and nothing when no text can be measured', () => {
    const svg = `<svg><rect x="0" y="0" width="100" height="50" fill="#DDEEFF"/>${text('#000000')}${text('#FFFFFF', 12, 40)}</svg>`;
    expect(weakestTextContrast(svg, true)).toBeCloseTo(contrast('#FFFFFF', '#DDEEFF'));
    expect(weakestTextContrast('<svg><rect x="0" y="0" width="9" height="9" fill="#FFFFFF"/></svg>', true)).toBeUndefined();
    const gradient = `<svg><rect x="0" y="0" width="100" height="50" fill="url(#g)"/>${text('#FFFFFF')}</svg>`;
    expect(weakestTextContrast(gradient, true)).toBeUndefined();
    expect(weakestTextContrast(`<svg>${text('none')}</svg>`, true)).toBeUndefined();
  });

  it('skips a path with a command the engine does not write', () => {
    const relative = '<path d="m0,0 l100,0 l0,50 z" fill="#DDEEFF"/>';
    expect(weakestTextContrast(`<svg>${relative}${text('#FFFFFF')}</svg>`, true)).toBeCloseTo(contrast('#FFFFFF', '#1b1b1b'));
  });
});
