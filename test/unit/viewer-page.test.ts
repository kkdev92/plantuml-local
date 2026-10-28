import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Window, type HTMLElement, type HTMLImageElement } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { viewerBody } from '../../src/viewer/viewer';

/**
 * The diagram viewer's page in happy-dom: the body the extension writes, its
 * style sheet, and zoom.js then viewer.js run as the page runs them. happy-dom
 * lays nothing out, so what depends on the page's size is not here; what the
 * page decides from its elements and events is: the focus and keys of its
 * toolbar, the end of a drag, and the rules its elements get.
 */

const media = join(__dirname, '../../media/viewer');
const read = (file: string): string => readFileSync(join(media, file), 'utf8');

const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const labels = {
  selectDiagram: 'Select a diagram',
  toolbar: 'Diagram zoom',
  zoomOut: 'Zoom Out',
  zoomIn: 'Zoom In',
  fit: 'Fit to Window',
  actualSize: 'Actual Size',
  zoomToArea: 'Zoom to Area',
  zoomLevel: 'Zoom {0}',
  exportPng: 'Export Diagram as PNG',
  copySvgText: 'Copy Diagram as SVG Text',
  copy: {
    text: 'Copy',
    label: 'Copy Diagram as PNG',
    copying: 'Copying…',
    copied: 'Copied.',
    failed: 'Could not copy: {0}',
    unmade: 'No PNG.',
    unwritten: 'Not taken.',
  },
};

/** The origin VS Code's frame posts the extension's messages with: the page's own. */
const ORIGIN = 'https://viewer.test';

interface Page {
  window: Window;
  stage: HTMLElement;
  byId(id: string): HTMLElement;
  /** The id of the element with the focus. */
  focused(): string | undefined;
  /** Each zoom button's `tabIndex`, in their order. */
  stops(): number[];
  /** Posts a drawing as the extension does, and waits until the page shows it. */
  show(): Promise<void>;
  /** Presses the key where the focus is; whether the page took it. */
  press(key: string): boolean;
  /** Sends a pointer event to the stage. */
  pointer(type: string, x: number, buttons: number): void;
}

const opened: Window[] = [];

afterEach(async () => {
  for (const window of opened.splice(0)) {
    // An error in the page's listeners is written to its console.
    const printed = window.happyDOM.virtualConsolePrinter.readAsString();
    await window.happyDOM.close();
    expect(printed).toBe('');
  }
});

function openPage(): Page {
  // To run the page's scripts, the only ones loaded into it.
  const window = new Window({
    url: `${ORIGIN}/`,
    settings: { enableJavaScriptEvaluation: true, suppressCodeGenerationFromStringsWarning: true },
  });
  opened.push(window);
  Object.defineProperty(window, 'origin', { value: ORIGIN });
  Object.assign(window, {
    acquireVsCodeApi: () => ({ postMessage: () => undefined, getState: () => undefined, setState: () => undefined }),
  });
  const { document } = window;
  const byId = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
  const style = document.createElement('style');
  style.textContent = read('viewer.css');
  document.head.append(style);
  document.body.innerHTML = viewerBody(labels, escape);
  // The size of a panel's stage, which happy-dom does not lay out.
  const stage = byId('stage');
  Object.defineProperty(stage, 'clientWidth', { value: 400 });
  Object.defineProperty(stage, 'clientHeight', { value: 300 });
  // The page loads the two as classic scripts, where viewer.js sees the
  // names zoom.js declares; happy-dom runs each script apart, so here they
  // run as one.
  const script = document.createElement('script');
  script.textContent = `${read('zoom.js')}\n${read('viewer.js')}`;
  document.body.append(script);
  expect(window.happyDOM.virtualConsolePrinter.readAsString()).toBe('');
  const tools = Array.from(document.querySelectorAll('#tools button')) as HTMLElement[];
  const image = byId('diagram') as HTMLImageElement;
  return {
    window,
    stage,
    byId,
    focused: () => document.activeElement?.id,
    stops: () => tools.map((button) => button.tabIndex),
    async show() {
      window.dispatchEvent(
        new window.MessageEvent('message', {
          origin: ORIGIN,
          data: {
            type: 'render',
            svg: '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="500"></svg>',
            label: 'Checkout',
            backdrop: '#ffffff',
            key: 'checkout',
          },
        })
      );
      await vi.waitFor(() => expect(image.hidden).toBe(false));
    },
    press(key) {
      const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      (document.activeElement ?? document.body).dispatchEvent(event);
      return event.defaultPrevented;
    },
    pointer(type, x, buttons) {
      stage.dispatchEvent(new window.PointerEvent(type, { pointerId: 1, button: 0, buttons, clientX: x, clientY: 100, bubbles: true }));
    },
  };
}

describe('the viewer page', () => {
  it('keeps each row of its zoom buttons, and of PNG and Copy, to the right when a narrow panel wraps them', () => {
    const page = openPage();
    const style = (id: string) => page.window.getComputedStyle(page.byId(id));

    // The bar keeps the two groups to the right; each group keeps its own
    // rows there too, rather than starting them at the left of the panel.
    expect(style('bar').justifyContent).toBe('flex-end');
    for (const id of ['tools', 'actions']) {
      expect(style(id).flexWrap).toBe('wrap');
      expect(style(id).justifyContent).toBe('flex-end');
    }
  });

  it('makes its zoom buttons one stop for Tab: the first until one is used, then the one used last', async () => {
    const page = openPage();

    expect(page.stops()).toEqual([0, -1, -1, -1, -1]);
    await page.show();
    page.byId('actual').focus();
    expect(page.focused()).toBe('actual');
    expect(page.stops()).toEqual([-1, -1, -1, 0, -1]);
  });

  it('moves between its zoom buttons with the left and right arrows, round from either end, without scrolling', async () => {
    const page = openPage();
    await page.show();
    const { stage } = page;
    const scroll = { left: stage.scrollLeft, top: stage.scrollTop };

    page.byId('zoom-out').focus();
    expect(page.press('ArrowRight')).toBe(true);
    expect(page.focused()).toBe('zoom-in');
    // The one moved to is the toolbar's stop for Tab.
    expect(page.stops()).toEqual([-1, 0, -1, -1, -1]);
    expect(page.press('ArrowLeft')).toBe(true);
    expect(page.focused()).toBe('zoom-out');
    // Round from the first to the last, and back.
    expect(page.press('ArrowLeft')).toBe(true);
    expect(page.focused()).toBe('area');
    expect(page.press('ArrowRight')).toBe(true);
    expect(page.focused()).toBe('zoom-out');
    expect({ left: stage.scrollLeft, top: stage.scrollTop }).toEqual(scroll);
  });

  it('ends a drag that moves the view when the page loses the pointer, as when the button is let go outside the panel', async () => {
    const page = openPage();
    await page.show();
    const { stage } = page;
    const start = stage.scrollLeft;

    page.pointer('pointerdown', 100, 1);
    expect(stage.classList.contains('dragging')).toBe(true);
    // The drag moves the view (the control).
    page.pointer('pointermove', 80, 1);
    expect(stage.scrollLeft).toBe(start + 20);

    // Let go outside the panel, the page hears of it as the pointer comes
    // back, by the capture it has lost: the view stays where it is.
    page.pointer('lostpointercapture', 30, 0);
    expect(stage.classList.contains('dragging')).toBe(false);
    page.pointer('pointermove', 30, 0);
    expect(stage.scrollLeft).toBe(start + 20);
  });

  it('ends a drag that moves the view when the pointer moves with the button up', async () => {
    const page = openPage();
    await page.show();
    const { stage } = page;
    const start = stage.scrollLeft;

    page.pointer('pointerdown', 100, 1);
    page.pointer('pointermove', 80, 1);
    expect(stage.scrollLeft).toBe(start + 20);

    page.pointer('pointermove', 30, 0);
    expect(stage.classList.contains('dragging')).toBe(false);
    expect(stage.scrollLeft).toBe(start + 20);
    // Pressed again without a pointerdown on the page, it is no drag.
    page.pointer('pointermove', 10, 1);
    expect(stage.scrollLeft).toBe(start + 20);
  });
});
