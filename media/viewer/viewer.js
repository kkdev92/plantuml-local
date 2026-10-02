// The diagram viewer's page (src/viewer/viewer.ts is the extension side).
// The SVG arrives as text and is shown through an <img> holding a Blob URL:
// as an image, nothing in it can run. The page asks for everything again
// whenever it is created, as it is each time the panel comes back into
// view. All it keeps is which file and diagram it shows, which VS Code
// hands back to bring the panel back after a restart, and how each diagram
// was zoomed.
//
// 100% is the size the SVG gives itself in its width and height, which is
// what PlantUML's `scale` sets. The stage scrolls; zooming resizes the
// image and keeps the point under the pointer, or at the centre, in place.
(function () {
  const vscode = acquireVsCodeApi();
  const select = document.getElementById('diagrams');
  const status = document.getElementById('status');
  const stage = document.getElementById('stage');
  const canvas = document.getElementById('canvas');
  const image = document.getElementById('diagram');
  const zoomText = document.getElementById('zoom');
  const buttons = {
    out: document.getElementById('zoom-out'),
    in: document.getElementById('zoom-in'),
    fit: document.getElementById('fit'),
    actual: document.getElementById('actual'),
  };

  /** Space between the diagram and the edges of the stage, in CSS pixels. */
  const MARGIN = 16;
  const MIN_ZOOM = 0.01;
  const MAX_ZOOM = 16;
  /** The factor of one step of the buttons and keys. */
  const STEP = 1.25;
  /** How many diagrams' views are kept, the least recently shown dropped first. */
  const KEPT = 200;

  const saved = vscode.getState() || {};
  /** What the extension asks to be kept, for a restart. */
  let keep = { uri: saved.uri, name: saved.name };
  /** How each diagram was last shown: fitted, or a zoom and the point at the centre, at 100%. */
  const views = new Map(Array.isArray(saved.views) ? saved.views.filter(isEntry) : []);
  let key = null;
  /** The diagram's size at 100%, or null while none is shown. */
  let size = null;
  let view = { fit: true };
  let zoom = 1;
  /** Where the image's top-left corner is in the scrolled area. */
  let at = { left: 0, top: 0 };
  let shown = null;
  let latest = null;
  let drag = null;
  let saving = undefined;

  function isEntry(entry) {
    return (
      Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'object' && entry[1] !== null
    );
  }

  const clamp = (value) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));

  /** The zoom showing the whole diagram, but never past 100%. */
  function fitZoom() {
    const width = (stage.clientWidth - 2 * MARGIN) / size.width;
    const height = (stage.clientHeight - 2 * MARGIN) / size.height;
    return clamp(Math.min(1, width, height));
  }

  /**
   * Sizes the image at `zoom`, and the area around it. The stylesheet keeps
   * the area at least as large as the stage, scroll bars or not, and centres
   * the image in it; where it ended up is read back once laid out.
   */
  function layout() {
    const width = size.width * zoom;
    const height = size.height * zoom;
    canvas.style.width = `${width + 2 * MARGIN}px`;
    canvas.style.height = `${height + 2 * MARGIN}px`;
    image.style.width = `${width}px`;
    image.style.height = `${height}px`;
    at = { left: image.offsetLeft, top: image.offsetTop };
  }

  /** The point of the diagram at the centre of the stage, at 100%. */
  function centre() {
    return {
      x: (stage.scrollLeft + stage.clientWidth / 2 - at.left) / zoom,
      y: (stage.scrollTop + stage.clientHeight / 2 - at.top) / zoom,
    };
  }

  /** Shows the diagram as `view` says: fitted, or at its zoom around its centre. */
  function apply() {
    if (size === null) {
      return;
    }
    const manual = view.fit !== true && [view.zoom, view.x, view.y].every(Number.isFinite);
    if (!manual) {
      view = { fit: true };
      // Measured without the scroll bars a larger zoom may have left.
      canvas.style.width = '0';
      canvas.style.height = '0';
    }
    zoom = manual ? clamp(view.zoom) : fitZoom();
    layout();
    if (manual) {
      stage.scrollLeft = at.left + view.x * zoom - stage.clientWidth / 2;
      stage.scrollTop = at.top + view.y * zoom - stage.clientHeight / 2;
    }
    indicate();
  }

  /**
   * Zooms to `next`, keeping the point of the diagram at (`x`, `y`) of the
   * stage where it is; at the centre of the stage without them, measured
   * again once scroll bars may have come or gone.
   */
  function zoomAt(next, x, y) {
    if (size === null) {
      return;
    }
    const before = { x: x ?? stage.clientWidth / 2, y: y ?? stage.clientHeight / 2 };
    const point = { x: (stage.scrollLeft + before.x - at.left) / zoom, y: (stage.scrollTop + before.y - at.top) / zoom };
    zoom = clamp(next);
    layout();
    const after = { x: x ?? stage.clientWidth / 2, y: y ?? stage.clientHeight / 2 };
    stage.scrollLeft = at.left + point.x * zoom - after.x;
    stage.scrollTop = at.top + point.y * zoom - after.y;
    view = { fit: false, zoom, ...centre() };
    indicate();
    remember();
  }

  const zoomBy = (factor) => zoomAt(zoom * factor);
  const actual = () => zoomAt(1);

  function fit() {
    if (size !== null) {
      view = { fit: true };
      apply();
      remember();
    }
  }

  function indicate() {
    zoomText.textContent = size === null ? '' : `${Math.round(zoom * 100)}%`;
    buttons.fit.setAttribute('aria-pressed', String(size !== null && view.fit === true));
    for (const button of Object.values(buttons)) {
      button.disabled = size === null;
    }
  }

  /** Keeps this diagram's view, and saves everything the page keeps. */
  function remember() {
    clearTimeout(saving);
    if (key !== null) {
      views.delete(key);
      views.set(key, view);
      while (views.size > KEPT) {
        views.delete(views.keys().next().value);
      }
    }
    vscode.setState({ ...keep, views: [...views] });
  }

  buttons.out.addEventListener('click', () => zoomBy(1 / STEP));
  buttons.in.addEventListener('click', () => zoomBy(STEP));
  buttons.fit.addEventListener('click', fit);
  buttons.actual.addEventListener('click', actual);

  // A plain wheel scrolls, and Shift sideways, as anywhere. With Ctrl (Cmd
  // on macOS), or as a touchpad pinch, which arrives the same way, it zooms
  // at the pointer.
  stage.addEventListener(
    'wheel',
    (event) => {
      if (size === null || !(event.ctrlKey || event.metaKey)) {
        return;
      }
      event.preventDefault();
      const box = stage.getBoundingClientRect();
      zoomAt(zoom * Math.exp(-event.deltaY / 500), event.clientX - box.left, event.clientY - box.top);
    },
    { passive: false }
  );

  stage.addEventListener('pointerdown', (event) => {
    stage.focus({ preventScroll: true });
    const box = stage.getBoundingClientRect();
    // Not on a scroll bar, which moves the view by itself.
    const onBar = event.clientX - box.left >= stage.clientWidth || event.clientY - box.top >= stage.clientHeight;
    if (size === null || event.button !== 0 || onBar) {
      return;
    }
    drag = { x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop };
    stage.setPointerCapture(event.pointerId);
    stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', (event) => {
    if (drag !== null) {
      stage.scrollLeft = drag.left - (event.clientX - drag.x);
      stage.scrollTop = drag.top - (event.clientY - drag.y);
    }
  });
  const stopDrag = () => {
    drag = null;
    stage.classList.remove('dragging');
  };
  stage.addEventListener('pointerup', stopDrag);
  stage.addEventListener('pointercancel', stopDrag);

  // However the view moved, the new centre is kept once it stops.
  stage.addEventListener('scroll', () => {
    if (size !== null && view.fit !== true) {
      view = { fit: false, zoom, ...centre() };
      clearTimeout(saving);
      saving = setTimeout(remember, 200);
    }
  });

  // The panel resized, or scroll bars came or went: fitted again, or around the same centre.
  new ResizeObserver(apply).observe(stage);

  canvas.style.padding = `${MARGIN}px`;

  // Unmodified keys only, so that VS Code's own shortcuts still work, and
  // not while the list of diagrams has the focus.
  document.addEventListener('keydown', (event) => {
    if (size === null || event.ctrlKey || event.metaKey || event.altKey || event.target === select) {
      return;
    }
    const step = event.shiftKey ? 200 : 40;
    switch (event.key) {
      case '+':
      case '=':
        zoomBy(STEP);
        break;
      case '-':
        zoomBy(1 / STEP);
        break;
      case '0':
        fit();
        break;
      case '1':
        actual();
        break;
      case 'ArrowLeft':
        stage.scrollBy(-step, 0);
        break;
      case 'ArrowRight':
        stage.scrollBy(step, 0);
        break;
      case 'ArrowUp':
        stage.scrollBy(0, -step);
        break;
      case 'ArrowDown':
        stage.scrollBy(0, step);
        break;
      default:
        return;
    }
    event.preventDefault();
  });

  select.addEventListener('change', () => {
    vscode.postMessage({ type: 'select', index: Number(select.value) });
  });

  window.addEventListener('message', (event) => {
    // VS Code's frame around the page posts the extension's messages with
    // the page's own origin; anything else is not from the extension.
    if (event.origin !== window.origin) {
      return;
    }
    const message = event.data;
    if (message.type === 'diagrams') {
      select.replaceChildren(
        ...message.items.map((label, index) => {
          const option = document.createElement('option');
          option.value = String(index);
          option.textContent = label;
          return option;
        })
      );
      select.value = String(message.selected);
      select.hidden = message.items.length < 2 && message.selected === 0;
      keep = message.keep;
      remember();
    } else if (message.type === 'render') {
      const url = URL.createObjectURL(new Blob([message.svg], { type: 'image/svg+xml' }));
      latest = url;
      const next = new Image();
      next.src = url;
      // Its size is known once it is decoded; until then the last drawing stays.
      next
        .decode()
        .catch(() => undefined)
        .then(() => {
          if (url !== latest) {
            URL.revokeObjectURL(url);
            return;
          }
          if (shown !== null) {
            URL.revokeObjectURL(shown);
          }
          shown = url;
          image.src = url;
          image.hidden = false;
          image.style.background = message.backdrop;
          image.style.boxShadow = `0 0 0 8px ${message.backdrop}`;
          size = { width: next.naturalWidth || 1, height: next.naturalHeight || 1 };
          // The same diagram drawn again keeps its view; another gets its own.
          if (message.key !== key) {
            key = message.key;
            view = views.get(key) || { fit: true };
          }
          apply();
        });
    } else if (message.type === 'status') {
      status.textContent = message.text;
      status.classList.toggle('error', message.error === true);
      if (message.clear === true) {
        latest = null;
        size = null;
        image.hidden = true;
        canvas.style.width = '0';
        canvas.style.height = '0';
        indicate();
      }
    }
  });

  indicate();
  vscode.postMessage({ type: 'ready' });
})();
