import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

interface Point {
  x: number;
  y: number;
}
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}
interface Area {
  from: Point;
  to: Point;
  visible: Box;
  diagram: Box;
  zoom: number;
  room: { width: number; height: number };
}
interface View {
  zoom: number;
  x: number;
  y: number;
}
interface Size {
  width: number;
  height: number;
}
interface Fit {
  client: Size;
  box: Size;
  size: Size;
  margin: number;
}

/**
 * media/viewer/zoom.js, which the viewer's page runs before its own script,
 * read as a script the way the page reads it.
 */
const viewerZoom = runInNewContext(
  `${readFileSync(join(__dirname, '../../media/viewer/zoom.js'), 'utf8')}\n;viewerZoom`,
  {}
) as { clamp(value: number): number; toArea(area: Area): View | null; toFit(fit: Fit): number };

/**
 * A stage of 400 × 300 CSS pixels, scrolled to the top left, with a diagram
 * of 1000 × 500 at 100% drawn 16 pixels in, the margin the page keeps, which
 * it also keeps around the area it zooms to.
 */
const stage = (overrides: Partial<Area> = {}): Area => ({
  from: { x: 0, y: 0 },
  to: { x: 0, y: 0 },
  visible: { left: 0, top: 0, width: 400, height: 300 },
  diagram: { left: 16, top: 16, width: 1000, height: 500 },
  zoom: 1,
  room: { width: 400 - 32, height: 300 - 32 },
  ...overrides,
});

const expectView = (view: View | null, expected: View): void => {
  expect(view).not.toBeNull();
  expect(view!.zoom).toBeCloseTo(expected.zoom, 10);
  expect(view!.x).toBeCloseTo(expected.x, 10);
  expect(view!.y).toBeCloseTo(expected.y, 10);
};

describe('viewerZoom.toArea', () => {
  it('fits the area marked in the stage, around its centre at 100%', () => {
    // 200 × 100: the width is what limits it.
    const view = viewerZoom.toArea(stage({ from: { x: 116, y: 66 }, to: { x: 316, y: 166 } }));

    expectView(view, { zoom: 368 / 200, x: 200, y: 100 });
  });

  it('takes the area whichever way it was dragged', () => {
    const forward = viewerZoom.toArea(stage({ from: { x: 116, y: 66 }, to: { x: 316, y: 166 } }));

    for (const [from, to] of [
      [{ x: 316, y: 166 }, { x: 116, y: 66 }],
      [{ x: 116, y: 166 }, { x: 316, y: 66 }],
      [{ x: 316, y: 66 }, { x: 116, y: 166 }],
    ] as const) {
      expect(viewerZoom.toArea(stage({ from, to }))).toEqual(forward);
    }
  });

  it('counts the zoom and the scroll position in, giving the centre at 100%', () => {
    // At 200%, scrolled to (500, 300): 200 × 100 on the screen is 100 × 50 of the diagram.
    const view = viewerZoom.toArea(
      stage({
        from: { x: 616, y: 366 },
        to: { x: 816, y: 466 },
        visible: { left: 500, top: 300, width: 400, height: 300 },
        diagram: { left: 16, top: 16, width: 2000, height: 1000 },
        zoom: 2,
      })
    );

    expectView(view, { zoom: (368 * 2) / 200, x: 350, y: 200 });
  });

  it('changes nothing for an area under 4 CSS pixels wide or high, as a click is', () => {
    const at = (width: number, height: number): View | null =>
      viewerZoom.toArea(stage({ from: { x: 116, y: 66 }, to: { x: 116 + width, y: 66 + height } }));

    expect(at(0, 0)).toBeNull();
    expect(at(3.99, 100)).toBeNull();
    expect(at(100, 3.99)).toBeNull();
    expect(at(-3.99, -100)).toBeNull();
    // 4 is enough, and as far as the zoom goes.
    expectView(at(4, 4), { zoom: 16, x: 102, y: 52 });
  });

  it('zooms to what of the area is on the diagram', () => {
    // From the margin, above and to the left of the diagram: 100 × 50 of it.
    expectView(viewerZoom.toArea(stage({ from: { x: 0, y: 0 }, to: { x: 116, y: 66 } })), {
      zoom: 368 / 100,
      x: 50,
      y: 25,
    });
    // Around a diagram smaller than the stage: the whole diagram.
    expectView(
      viewerZoom.toArea(
        stage({
          from: { x: 50, y: 50 },
          to: { x: 350, y: 260 },
          diagram: { left: 100, top: 80, width: 200, height: 140 },
        })
      ),
      { zoom: 368 / 200, x: 100, y: 70 }
    );
  });

  it('changes nothing for an area off the diagram', () => {
    // In the margin, left of it and above it.
    expect(viewerZoom.toArea(stage({ from: { x: 0, y: 0 }, to: { x: 15, y: 300 } }))).toBeNull();
    expect(viewerZoom.toArea(stage({ from: { x: 0, y: 0 }, to: { x: 400, y: 15 } }))).toBeNull();
    // Right of and below a diagram smaller than the stage.
    const small = { left: 100, top: 80, width: 200, height: 140 };
    expect(viewerZoom.toArea(stage({ from: { x: 301, y: 0 }, to: { x: 400, y: 300 }, diagram: small }))).toBeNull();
    expect(viewerZoom.toArea(stage({ from: { x: 0, y: 221 }, to: { x: 400, y: 300 }, diagram: small }))).toBeNull();
    // Touching its edge only.
    expect(viewerZoom.toArea(stage({ from: { x: 300, y: 80 }, to: { x: 380, y: 220 }, diagram: small }))).toBeNull();
  });

  it('zooms to what of the area is in sight, the pointer having left the stage', () => {
    // Beyond the bottom right of the stage: up to it, 284 × 234.
    expectView(viewerZoom.toArea(stage({ from: { x: 116, y: 66 }, to: { x: 900, y: 700 } })), {
      zoom: 268 / 234,
      x: 242,
      y: 167,
    });
    // Beyond the top left: up to the diagram, which starts in sight.
    expectView(viewerZoom.toArea(stage({ from: { x: 116, y: 66 }, to: { x: -50, y: -50 } })), {
      zoom: 368 / 100,
      x: 50,
      y: 25,
    });
    // Scrolled on: what was marked before scrolling and is now out of sight is left out.
    expectView(
      viewerZoom.toArea(
        stage({ from: { x: 116, y: 66 }, to: { x: 316, y: 166 }, visible: { left: 216, top: 0, width: 400, height: 300 } })
      ),
      { zoom: 268 / 100, x: 250, y: 100 }
    );
  });

  it('keeps the zoom within 1% and 1600%', () => {
    // A 4-pixel area at 1600%: as close as it goes.
    expectView(
      viewerZoom.toArea(
        stage({ from: { x: 100, y: 100 }, to: { x: 104, y: 104 }, diagram: { left: 16, top: 16, width: 16000, height: 8000 }, zoom: 16 })
      ),
      { zoom: 16, x: 5.375, y: 5.375 }
    );
    // A large area in a stage with hardly any room, or none past its margins.
    for (const room of [
      { width: 1, height: 1 },
      { width: -20, height: -20 },
      { width: 0, height: 0 },
    ]) {
      expect(viewerZoom.toArea(stage({ from: { x: 16, y: 16 }, to: { x: 400, y: 300 }, room }))?.zoom).toBe(0.01);
    }
  });

  it('gives no view for what is not a finite number', () => {
    const marked = { from: { x: 116, y: 66 }, to: { x: 316, y: 166 } };
    for (const area of [
      stage({ ...marked, from: { x: Number.NaN, y: 66 } }),
      stage({ ...marked, to: { x: 316, y: Number.NaN } }),
      stage({ ...marked, zoom: Number.NaN }),
      stage({ ...marked, zoom: 0 }),
      stage({ ...marked, zoom: -1 }),
      stage({ ...marked, room: { width: Number.NaN, height: 268 } }),
      stage({ ...marked, diagram: { left: 16, top: 16, width: Number.NaN, height: 500 } }),
      stage({ ...marked, visible: { left: Number.NaN, top: 0, width: 400, height: 300 } }),
    ]) {
      expect(viewerZoom.toArea(area)).toBeNull();
    }
  });

  it('gives only finite views within the zoom limits, wherever the pointer goes', () => {
    const places = [-1e9, -500, -1, 0, 3, 15, 16, 17, 100, 299, 300, 399, 400, 401, 1016, 1e9];
    let views = 0;
    for (const x0 of places) {
      for (const y0 of places) {
        for (const [x1, y1] of [
          [x0 + 4, y0 + 4],
          [200, 150],
          [1e9, -1e9],
        ]) {
          for (const zoom of [0.01, 1, 16]) {
            const view = viewerZoom.toArea(stage({ from: { x: x0, y: y0 }, to: { x: x1!, y: y1! }, zoom }));
            if (view !== null) {
              views += 1;
              expect([view.zoom, view.x, view.y].every(Number.isFinite)).toBe(true);
              expect(view.zoom).toBeGreaterThanOrEqual(0.01);
              expect(view.zoom).toBeLessThanOrEqual(16);
            }
          }
        }
      }
    }
    // Some of them come to a view, so the checks above were made.
    expect(views).toBeGreaterThan(100);
  });
});

describe('viewerZoom.toFit', () => {
  const whole = (width: number, height: number): Pick<Fit, 'client' | 'box'> => ({
    client: { width, height },
    box: { width, height },
  });

  it('fits the whole diagram in the stage less the margin each side', () => {
    const wide = viewerZoom.toFit({ ...whole(400, 300), size: { width: 1000, height: 500 }, margin: 16 });
    const tall = viewerZoom.toFit({ ...whole(400, 300), size: { width: 500, height: 1000 }, margin: 16 });

    expect(wide).toBeCloseTo(368 / 1000, 10);
    expect(tall).toBeCloseTo(268 / 1000, 10);
  });

  it('never zooms past 100%', () => {
    expect(viewerZoom.toFit({ ...whole(400, 300), size: { width: 100, height: 50 }, margin: 16 })).toBe(1);
  });

  it('keeps the diagram inside a stage a fraction of a pixel high or wide, whichever way clientWidth and clientHeight round it', () => {
    // Heights measured under a toolbar 21.854 px high, a width measured
    // beside them and one that rounds up; the client size is the box
    // rounded, up or down.
    const fractions = [762.812, 750.812, 724.958, 761.479, 699.104, 543.3, 543.7];
    let fitted = 0;
    for (const length of fractions) {
      for (const client of [Math.floor(length), Math.ceil(length)]) {
        for (const size of [
          { width: 300, height: 2000 },
          { width: 2000, height: 300 },
        ]) {
          const tall = size.height > size.width;
          const fit = {
            client: tall ? { width: 1000, height: client } : { width: client, height: 1000 },
            box: tall ? { width: 1000, height: length } : { width: length, height: 1000 },
            size,
            margin: 16,
          };
          const zoom = viewerZoom.toFit(fit);
          const along = tall ? size.height * zoom + 32 : size.width * zoom + 32;
          expect(along).toBeLessThanOrEqual(length);
          // Rounded down, not by more: less than a pixel is given up.
          expect(along).toBeGreaterThan(length - 1);
          fitted += 1;
        }
      }
    }
    expect(fitted).toBe(fractions.length * 4);
  });

  it('fits to the client size where a scroll bar takes from the box', () => {
    const zoom = viewerZoom.toFit({
      client: { width: 528, height: 725 },
      box: { width: 543.3, height: 724.958 },
      size: { width: 2000, height: 300 },
      margin: 16,
    });
    expect(zoom).toBeCloseTo((528 - 32) / 2000, 10);
  });
});

describe('viewerZoom.clamp', () => {
  it('keeps a zoom within 1% and 1600%', () => {
    expect(viewerZoom.clamp(0)).toBe(0.01);
    expect(viewerZoom.clamp(0.005)).toBe(0.01);
    expect(viewerZoom.clamp(1)).toBe(1);
    expect(viewerZoom.clamp(16)).toBe(16);
    expect(viewerZoom.clamp(100)).toBe(16);
  });
});
