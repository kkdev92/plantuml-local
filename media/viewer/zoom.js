// The zoom of the diagram viewer's page, viewer.js, which runs after this
// and takes it from here: how far the diagram zooms, the zoom that fits it
// in the stage, and the view that shows an area marked on it. Apart from the
// page, so that it is tested on its own.
//
// Points and boxes are in CSS pixels of the area the stage scrolls. A view is
// a zoom and the point of the diagram at the centre of the stage, at 100%.
const viewerZoom = (() => {
  const MIN_ZOOM = 0.01;
  const MAX_ZOOM = 16;
  /** Less wide or high than this, an area is too small to zoom to, as a click is. */
  const SMALLEST = 4;

  const clamp = (value) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));

  /**
   * The view that fits in `room` the area marked from `from` to `to`, or
   * null for none. The area is what of the rectangle is in sight, in
   * `visible`, and on the diagram, which fills `diagram` at `zoom`. Anything
   * not a finite number comes to null, rather than to a view that could not
   * be shown.
   */
  function toArea({ from, to, visible, diagram, zoom, room }) {
    const left = Math.max(Math.min(from.x, to.x), visible.left, diagram.left);
    const top = Math.max(Math.min(from.y, to.y), visible.top, diagram.top);
    const right = Math.min(Math.max(from.x, to.x), visible.left + visible.width, diagram.left + diagram.width);
    const bottom = Math.min(Math.max(from.y, to.y), visible.top + visible.height, diagram.top + diagram.height);
    // Asked this way round, NaN, which fails every comparison, is too small too.
    if (!(right - left >= SMALLEST && bottom - top >= SMALLEST && zoom > 0)) {
      return null;
    }
    const view = {
      zoom: clamp(Math.min((room.width * zoom) / (right - left), (room.height * zoom) / (bottom - top))),
      x: ((left + right) / 2 - diagram.left) / zoom,
      y: ((top + bottom) / 2 - diagram.top) / zoom,
    };
    return [view.zoom, view.x, view.y].every(Number.isFinite) ? view : null;
  }

  /**
   * The zoom that shows the whole of a diagram of `size` at 100% in the
   * stage, less `margin` each side; never past 100%. The stage's size need
   * not be whole pixels, as the height of the toolbar above it is not, and
   * its `client` size, clientWidth and clientHeight, rounds it either way: a
   * diagram fitted to a size rounded up would overhang by the fraction, and
   * scroll. So the room is the stage's `box` rounded down, where that is
   * less than the client size, which a scroll bar takes from.
   */
  function toFit({ client, box, size, margin }) {
    const width = Math.min(client.width, Math.floor(box.width)) - 2 * margin;
    const height = Math.min(client.height, Math.floor(box.height)) - 2 * margin;
    return clamp(Math.min(1, width / size.width, height / size.height));
  }

  return { clamp, toArea, toFit };
})();
