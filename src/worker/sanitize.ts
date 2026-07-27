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
 *   fragment references (`#…`) within the document
 *
 * DOMPurify is deliberately not used here: under happy-dom its
 * innerHTML-based parsing mangles SVG structure (the root `<svg>` element
 * disappears and sibling shapes are dropped — verified empirically).
 * Walking a tree parsed as `image/svg+xml` keeps the document intact.
 */

const DANGEROUS_ELEMENTS = new Set(['script', 'foreignobject', 'iframe', 'embed', 'object']);
const LINK_ATTRIBUTES = new Set(['href', 'xlink:href', 'src']);

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
    } else if (LINK_ATTRIBUTES.has(name) && !attribute.value.startsWith('#')) {
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
