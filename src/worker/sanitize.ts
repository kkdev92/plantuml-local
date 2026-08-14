import type { Window } from 'happy-dom';

/**
 * SVG sanitisation for engine output.
 *
 * The SVG comes from our own engine rendering the user's local Markdown,
 * but it is still inserted into the Markdown preview as raw HTML, so we
 * strip anything executable or capable of reaching the network before it
 * leaves the worker:
 *
 * - script-bearing elements (`<script>`, `<foreignObject>`, …)
 * - event handler attributes (`on*`)
 * - link attributes (`href`, `xlink:href`, `src`) unless they are
 *   fragment references (`#…`) within the document, or an inline sprite
 *   PNG (see {@link isSpritePng})
 *
 * DOMPurify is deliberately not used here: under happy-dom its
 * innerHTML-based parsing mangles SVG structure (the root `<svg>` element
 * disappears and sibling shapes are dropped — verified empirically).
 * Walking a tree parsed as `image/svg+xml` keeps the document intact.
 */

const DANGEROUS_ELEMENTS = new Set(['script', 'foreignobject', 'iframe', 'embed', 'object']);
const LINK_ATTRIBUTES = new Set(['href', 'xlink:href', 'src']);

/**
 * Base64 of the eight-byte PNG signature. Those bytes fix the first ten
 * characters of the encoding regardless of what follows, so matching the
 * prefix checks the container without decoding the payload.
 */
const PNG_SIGNATURE_BASE64 = 'iVBORw0KGg';

/** Nothing outside the base64 alphabet, so no second URI can be smuggled in. */
const SPRITE_PNG = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;

/**
 * Whether a link value is a sprite PNG this extension itself produced.
 *
 * PlantUML rasterises `sprite` definitions — the mechanism behind icon
 * sets like Azure-PlantUML — through the canvas shim and emits the result
 * as an inline PNG on an `<image>`. Stripping it leaves an image element
 * with no image, so the icon renders as blank space.
 *
 * The allowance is deliberately narrow. It covers `<image href>` and
 * `<image xlink:href>` only, never `<a href>`, so it opens no navigation
 * path; the value must be base64 with no other characters, so it cannot
 * carry a second URI or break out of the attribute; and the payload must
 * begin with the PNG signature, so a `data:` URI merely *labelled*
 * `image/png` does not qualify. PNG cannot carry script the way SVG can,
 * and the bytes are inline rather than fetched, so the network-egress
 * concern behind the general rule does not apply.
 *
 * `data:text/html`, `data:image/svg+xml`, `javascript:` and remote URLs
 * stay blocked.
 */
function isSpritePng(element: ElementLike, attributeName: string, value: string): boolean {
  return (
    element.nodeName.toLowerCase() === 'image' &&
    attributeName !== 'src' &&
    value.startsWith(`data:image/png;base64,${PNG_SIGNATURE_BASE64}`) &&
    SPRITE_PNG.test(value)
  );
}

/** Element shape shared by happy-dom's HTML and XML element classes. */
interface ElementLike {
  nodeName: string;
  children: ArrayLike<ElementLike>;
  attributes: ArrayLike<{ name: string; value: string }>;
  remove(): void;
  removeAttribute(name: string): void;
}

function stripAttributes(element: ElementLike): void {
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    if (name.startsWith('on')) {
      element.removeAttribute(attribute.name);
    } else if (
      LINK_ATTRIBUTES.has(name) &&
      !attribute.value.startsWith('#') &&
      !isSpritePng(element, name, attribute.value)
    ) {
      element.removeAttribute(attribute.name);
    }
  }
}

function walk(element: ElementLike): void {
  for (const child of Array.from(element.children)) {
    if (DANGEROUS_ELEMENTS.has(child.nodeName.toLowerCase())) {
      child.remove();
      continue;
    }
    stripAttributes(child);
    walk(child);
  }
}

/**
 * Parses `svg` as an SVG document, strips dangerous content and returns
 * the serialised result. Throws if the input is not an SVG document.
 */
export function sanitizeSvg(window: Window, svg: string): string {
  const parsed = new window.DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = parsed.documentElement;

  if (root === null || root.nodeName.toLowerCase() !== 'svg') {
    throw new Error('PlantUML did not return an SVG document');
  }

  // The root <svg> carries attributes too (a hypothetical onload=…);
  // strip it with the same rules as every descendant.
  stripAttributes(root as unknown as ElementLike);
  walk(root as unknown as ElementLike);

  return new window.XMLSerializer().serializeToString(root);
}
