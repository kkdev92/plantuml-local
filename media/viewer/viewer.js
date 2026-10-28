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
// A drag moves the view, or, once Zoom to Area is pressed, marks the area to
// zoom to; zoom.js, which runs first, has how far to zoom and to what.
//
// A screen reader is told what comes of things, not what is under way: what
// a drawing comes to once drawing settles, and only when it is not what it
// was told last, as the file is drawn again each time it stops changing; the
// zoom the buttons and keys leave; and what came of a copy.
(function () {
  const vscode = acquireVsCodeApi();
  const select = document.getElementById('diagrams');
  const status = document.getElementById('status');
  const stage = document.getElementById('stage');
  const canvas = document.getElementById('canvas');
  const image = document.getElementById('diagram');
  const marquee = document.getElementById('marquee');
  const zoomText = document.getElementById('zoom');
  const regions = [...document.querySelectorAll('#announcer [role="status"]')];
  const buttons = {
    out: document.getElementById('zoom-out'),
    in: document.getElementById('zoom-in'),
    fit: document.getElementById('fit'),
    actual: document.getElementById('actual'),
    area: document.getElementById('area'),
  };

  /** Space between the diagram and the edges of the stage, in CSS pixels. */
  const MARGIN = 16;
  /** The factor of one step of the buttons and keys. */
  const STEP = 1.25;
  /** How many diagrams' views are kept, the least recently shown dropped first. */
  const KEPT = 200;
  /** How long a drawing's result stands, in milliseconds, before a screen reader is told it. */
  const SETTLE = 1000;
  /** How long the zoom stands before a screen reader is told it, so that a held key says it once. */
  const ZOOM_SETTLE = 500;

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
  /**
   * The stage's size when the page last put the view in place, and the
   * scroll that left until the user scrolls: a scroll event with another
   * size, or with that scroll, is not the user's (the scroll listener).
   */
  let placed = { width: 0, height: 0, left: NaN, top: NaN };
  let shown = null;
  let latest = null;
  let drag = null;
  /** Whether a drag marks an area to zoom to, rather than moving the view. */
  let marking = false;
  /** Where the area being marked starts, in the scrolled area, or null. */
  let mark = null;
  /** Where the pointer last was with its button down while marking it. */
  let reach = null;
  let saving = undefined;
  /** The result of a drawing a screen reader was told last, which it is not told again. */
  let told = null;
  let settling = undefined;
  let zooming = undefined;

  /**
   * Tells a screen reader `text`. The two regions take turns, so that the
   * same words said again are said again; the one not used is emptied, which
   * is not said. VS Code's own announcements do the same.
   */
  function announce(text) {
    const [now, other] = regions[0].textContent === text ? [regions[1], regions[0]] : regions;
    other.textContent = '';
    now.textContent = text;
  }

  /**
   * Tells a screen reader what a drawing came to, `spoken`, once nothing
   * newer has come for a while, unless it is what it was told last. Null,
   * for a drawing under way, tells it nothing: what it comes to will follow.
   */
  function settle(spoken) {
    clearTimeout(settling);
    if (typeof spoken !== 'string' || spoken === '') {
      return;
    }
    settling = setTimeout(() => {
      if (spoken !== told) {
        told = spoken;
        announce(spoken);
      }
    }, SETTLE);
  }

  function isEntry(entry) {
    return (
      Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'object' && entry[1] !== null
    );
  }

  const clamp = viewerZoom.clamp;

  /** The zoom showing the whole diagram, but never past 100%. */
  function fitZoom() {
    const box = stage.getBoundingClientRect();
    return viewerZoom.toFit({
      client: { width: stage.clientWidth, height: stage.clientHeight },
      box: { width: box.width, height: box.height },
      size,
      margin: MARGIN,
    });
  }

  /**
   * Sizes the image at `zoom`, and the area around it. The stylesheet keeps
   * the area at least as large as the stage, scroll bars or not, and centres
   * the image in it; where it ended up is read back once laid out.
   */
  function layout() {
    // An area being marked was marked on the layout this replaces.
    unmark();
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
    placed = { width: stage.clientWidth, height: stage.clientHeight, left: stage.scrollLeft, top: stage.scrollTop };
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
    tellZoom();
  }

  const zoomBy = (factor) => zoomAt(zoom * factor);
  const actual = () => zoomAt(1);

  function fit() {
    if (size !== null) {
      view = { fit: true };
      apply();
      remember();
      tellZoom();
    }
  }

  /**
   * Tells a screen reader the zoom the buttons, keys or wheel left, once it
   * stands. Fitting a diagram drawn again is not said: it follows typing.
   */
  function tellZoom() {
    clearTimeout(zooming);
    zooming = setTimeout(() => announce(zoomText.dataset.spoken.replace('{0}', zoomText.textContent)), ZOOM_SETTLE);
  }

  function indicate() {
    zoomText.textContent = size === null ? '' : `${Math.round(zoom * 100)}%`;
    buttons.fit.setAttribute('aria-pressed', String(size !== null && view.fit === true));
    for (const button of Object.values(buttons)) {
      button.disabled = size === null;
    }
    // The panel's context menu acts on the file's diagram once one is shown
    // (package.json), and is told which file it is.
    stage.dataset.vscodeContext = JSON.stringify(size === null ? {} : { 'plantumlLocal.viewerUri': keep.uri });
  }

  /** Turns marking an area to zoom to on or off, letting go of one being marked. */
  function setMarking(on) {
    marking = on && size !== null;
    unmark();
    stage.classList.toggle('marking', marking);
    buttons.area.setAttribute('aria-pressed', String(marking));
  }

  function unmark() {
    mark = null;
    reach = null;
    marquee.hidden = true;
  }

  /** Where the pointer of `event` is, in the scrolled area. */
  function pointOf(event) {
    const box = stage.getBoundingClientRect();
    return { x: stage.scrollLeft + event.clientX - box.left, y: stage.scrollTop + event.clientY - box.top };
  }

  /** The part of the scrolled area in sight. */
  function visible() {
    return { left: stage.scrollLeft, top: stage.scrollTop, width: stage.clientWidth, height: stage.clientHeight };
  }

  /** Shows the rectangle from where the area being marked starts to `to`, as much of it as is in sight. */
  function outline(to) {
    const sight = visible();
    const left = Math.max(Math.min(mark.x, to.x), sight.left);
    const top = Math.max(Math.min(mark.y, to.y), sight.top);
    marquee.style.left = `${left}px`;
    marquee.style.top = `${top}px`;
    marquee.style.width = `${Math.max(0, Math.min(Math.max(mark.x, to.x), sight.left + sight.width) - left)}px`;
    marquee.style.height = `${Math.max(0, Math.min(Math.max(mark.y, to.y), sight.top + sight.height) - top)}px`;
    marquee.hidden = false;
  }

  /**
   * Zooms to the area marked, which ends at `to`, and stops marking. An area
   * too small to zoom to, as a click is, or off the diagram, changes nothing.
   */
  function zoomToMark(to) {
    const next = viewerZoom.toArea({
      from: mark,
      to,
      visible: visible(),
      diagram: { left: at.left, top: at.top, width: size.width * zoom, height: size.height * zoom },
      zoom,
      room: { width: stage.clientWidth - 2 * MARGIN, height: stage.clientHeight - 2 * MARGIN },
    });
    unmark();
    if (next !== null) {
      setMarking(false);
      view = { fit: false, ...next };
      apply();
      remember();
      tellZoom();
    }
  }

  /**
   * Moves the view to an edge of the diagram, or puts its centre in the
   * middle, at the same zoom. Where the diagram fits, there is nowhere to go.
   */
  function moveTo(place) {
    if (size === null) {
      return;
    }
    if (place === 'top') {
      stage.scrollTop = 0;
    } else if (place === 'bottom') {
      stage.scrollTop = stage.scrollHeight;
    } else if (place === 'left') {
      stage.scrollLeft = 0;
    } else if (place === 'right') {
      stage.scrollLeft = stage.scrollWidth;
    } else if (place === 'centre') {
      stage.scrollLeft = at.left + (size.width * zoom - stage.clientWidth) / 2;
      stage.scrollTop = at.top + (size.height * zoom - stage.clientHeight) / 2;
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
  buttons.area.addEventListener('click', () => setMarking(!marking));

  // The zoom buttons are a toolbar, one stop for Tab: the button used last,
  // the first until then. The left and right arrow keys move between them
  // (the keydown listener).
  const tools = [...document.querySelectorAll('#tools button')];
  function rove(to) {
    for (const button of tools) {
      button.tabIndex = button === to ? 0 : -1;
    }
  }
  rove(tools[0]);
  document.getElementById('tools').addEventListener('focusin', (event) => {
    if (tools.includes(event.target)) {
      rove(event.target);
    }
  });

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
    stage.setPointerCapture(event.pointerId);
    if (marking) {
      mark = pointOf(event);
      reach = mark;
      outline(mark);
      return;
    }
    drag = { x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop };
    stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', (event) => {
    if (mark !== null) {
      if ((event.buttons & 1) === 0) {
        // Let go where the page did not hear it, as lostpointercapture says.
        zoomToMark(reach);
      } else {
        reach = pointOf(event);
        outline(reach);
      }
    } else if (drag !== null) {
      if ((event.buttons & 1) === 0) {
        // The same for a drag that moves the view: it ends where it is.
        stopDrag();
      } else {
        stage.scrollLeft = drag.left - (event.clientX - drag.x);
        stage.scrollTop = drag.top - (event.clientY - drag.y);
      }
    }
  });
  const stopDrag = () => {
    drag = null;
    stage.classList.remove('dragging');
  };
  stage.addEventListener('pointerup', (event) => {
    if (mark !== null) {
      zoomToMark(pointOf(event));
    }
    stopDrag();
  });
  stage.addEventListener('pointercancel', () => {
    unmark();
    stopDrag();
  });
  // Let go outside the panel, the button can come up with no pointerup for
  // the page, which hears of it only when the pointer comes back, by the
  // capture it has lost. The area then ends where the pointer last was with
  // the button down, kept to what is in sight, as it would have on pointerup;
  // a drag that moves the view ends where it is.
  stage.addEventListener('lostpointercapture', () => {
    if (mark !== null) {
      zoomToMark(reach);
    }
    stopDrag();
  });

  // However the user moved the view, the new centre is kept once it stops.
  // A scroll event is told at the next frame, before the ResizeObserver: as
  // the panel resizes, one comes for the scroll the page made to keep the
  // view, or the browser made to keep it in the stage, once the stage has
  // taken its next size, and the centre measured then would move the view a
  // little each time. Those are left to the ResizeObserver, which keeps the
  // centre meant.
  stage.addEventListener('scroll', () => {
    if (size === null || view.fit === true) {
      return;
    }
    if (stage.clientWidth !== placed.width || stage.clientHeight !== placed.height) {
      return;
    }
    if (Math.abs(stage.scrollLeft - placed.left) < 0.5 && Math.abs(stage.scrollTop - placed.top) < 0.5) {
      return;
    }
    placed = { ...placed, left: NaN, top: NaN };
    view = { fit: false, zoom, ...centre() };
    clearTimeout(saving);
    saving = setTimeout(remember, 200);
  });

  // The panel resized, or scroll bars came or went: fitted again, or around the same centre.
  new ResizeObserver(apply).observe(stage);

  canvas.style.padding = `${MARGIN}px`;

  // Unmodified keys only, so that VS Code's own shortcuts still work, and
  // not while the list of diagrams has the focus. Shift takes Home and End
  // sideways, as it does the wheel.
  document.addEventListener('keydown', (event) => {
    if (size === null || event.ctrlKey || event.metaKey || event.altKey || event.target === select) {
      return;
    }
    // On the toolbar, left and right go to the button before or after,
    // round from either end, rather than scrolling.
    const tool = tools.indexOf(event.target);
    if (tool !== -1 && !event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      tools[(tool + (event.key === 'ArrowRight' ? 1 : tools.length - 1)) % tools.length].focus();
      event.preventDefault();
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
      case 'Home':
        moveTo(event.shiftKey ? 'left' : 'top');
        break;
      case 'End':
        moveTo(event.shiftKey ? 'right' : 'bottom');
        break;
      case 'c':
      case 'C':
        moveTo('centre');
        break;
      case 'z':
      case 'Z':
        setMarking(!marking);
        break;
      case 'Escape':
        if (!marking) {
          return;
        }
        setMarking(false);
        break;
      default:
        return;
    }
    event.preventDefault();
  });

  select.addEventListener('change', () => {
    vscode.postMessage({ type: 'select', index: Number(select.value) });
  });

  document.getElementById('export-png').addEventListener('click', () => {
    vscode.postMessage({ type: 'exportPng' });
  });

  // Copy SVG puts the SVG text on the clipboard, which the extension writes
  // itself: the text needs no drawing, so the page has nothing to add.
  document.getElementById('copy-svg').addEventListener('click', () => {
    vscode.postMessage({ type: 'copySvg' });
  });

  // Copy puts on the clipboard the PNG the PNG button would write. The
  // extension has no clipboard for images, so the page writes it: the write
  // starts at once, while the page has the focus, and takes the PNG once the
  // extension has drawn the diagram for it.
  const copyButton = document.getElementById('copy-png');
  const copyText = copyButton.dataset;
  /** How to answer each copy under way, by its number. */
  const copies = new Map();
  let copied = 0;
  /** What the extension last said in the status line, which a copy's word stands over for a while. */
  let said = { text: '', error: false };
  let restoring = undefined;

  function say(text, error, fade) {
    clearTimeout(restoring);
    status.textContent = text;
    status.classList.toggle('error', error);
    if (fade) {
      restoring = setTimeout(() => {
        if (status.textContent === text) {
          status.textContent = said.text;
          status.classList.toggle('error', said.error);
        }
      }, 4000);
    }
  }

  /** Why a copy was refused, in words fit to show: the extension's, or the page's own. */
  class Refusal extends Error {}

  // Anything else, such as the clipboard declining the image, is told in the
  // panel's words rather than the browser's.
  function fail(error) {
    const text = copyText.failed.replace('{0}', error instanceof Refusal ? error.message : copyText.unwritten);
    say(text, true, false);
    announce(text);
  }

  /** Draws the PNG of a copy, as media/png/png.js draws an exported one. */
  async function toPng(drawing) {
    const url = URL.createObjectURL(new Blob([drawing.svg], { type: 'image/svg+xml' }));
    try {
      const picture = new Image();
      picture.src = url;
      await picture.decode();
      const surface = document.createElement('canvas');
      surface.width = drawing.width;
      surface.height = drawing.height;
      const context = surface.getContext('2d');
      context.fillStyle = drawing.background;
      context.fillRect(0, 0, surface.width, surface.height);
      context.drawImage(picture, 0, 0, surface.width, surface.height);
      const png = await new Promise((resolve) => surface.toBlob(resolve, 'image/png'));
      // A canvas past what the browser can draw stops drawing without saying
      // so: the size in the PNG's header is checked, not assumed.
      const header = png === null ? null : new DataView(await png.slice(0, 24).arrayBuffer());
      if (header === null || header.byteLength < 24 || header.getUint32(16) !== drawing.width || header.getUint32(20) !== drawing.height) {
        throw new Refusal(copyText.unmade);
      }
      return png;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function copy() {
    const id = ++copied;
    const png = new Promise((resolve, reject) => copies.set(id, { resolve, reject })).then(toPng);
    let written;
    try {
      written = navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    } catch (error) {
      copies.delete(id);
      fail(error);
      return;
    }
    vscode.postMessage({ type: 'copyPng', id });
    say(copyText.copying, false, false);
    // One reason is given: the drawing's, or else the clipboard's.
    written.catch(() => undefined);
    png
      .then(() => written)
      .then(() => {
        say(copyText.copied, false, true);
        announce(copyText.copied);
      }, fail);
  }

  copyButton.addEventListener('click', copy);

  // Ctrl+C (Cmd+C on macOS) and Copy in the panel's context menu reach the
  // page as its copy command: they copy the diagram too, unless text is
  // selected.
  document.addEventListener('copy', (event) => {
    if (size === null || document.getSelection()?.isCollapsed === false) {
      return;
    }
    event.preventDefault();
    copy();
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
          image.alt = message.label;
          stage.setAttribute('aria-label', message.label);
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
    } else if (message.type === 'copy' || message.type === 'copyFailed') {
      const waiting = copies.get(message.id);
      copies.delete(message.id);
      if (waiting !== undefined && message.type === 'copy') {
        waiting.resolve(message);
      } else if (waiting !== undefined) {
        waiting.reject(new Refusal(message.message));
      }
    } else if (message.type === 'status') {
      clearTimeout(restoring);
      said = { text: message.text, error: message.error === true };
      status.textContent = message.text;
      status.classList.toggle('error', message.error === true);
      settle(message.spoken);
      if (message.clear === true) {
        latest = null;
        size = null;
        setMarking(false);
        image.hidden = true;
        stage.removeAttribute('aria-label');
        canvas.style.width = '0';
        canvas.style.height = '0';
        indicate();
      }
    } else if (message.type === 'act') {
      // Chosen in the panel's context menu.
      if (message.action === 'zoomToArea') {
        setMarking(true);
      } else {
        moveTo(message.action);
      }
    }
  });

  indicate();
  vscode.postMessage({ type: 'ready' });
})();
