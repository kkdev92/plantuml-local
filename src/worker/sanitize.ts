import type { Window } from 'happy-dom';

import { isInlinePng } from '../core/inline-png';

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
 * - markup that loads or navigates with no link attribute: `<style>`,
 *   `<meta>` (a refresh), `<link>`, `<base>`, and CSS in an attribute that
 *   calls any function but `url(#…)` (see {@link reachesOutside})
 *
 * whatever prefix their names are written with (see {@link localPart}).
 *
 * The same SVG is what an export writes to disk, and a file is shared with
 * people who were never meant to see the source. So everything the engine
 * embeds without drawing it goes too:
 *
 * - processing instructions and comments. The engine appends a
 *   `plantuml-src` processing instruction holding the whole diagram
 *   source, compressed but not encrypted: comments, preprocessor
 *   variables and the names of elements hidden with `hide` all decode
 *   back out of it. PlantUML's command line has `-nometadata` to leave it
 *   out; the browser engine has no such option.
 * - `data-*` attributes. The engine tags elements with `data-qualified-name`
 *   and `data-source-line`, and the names include aliases and elements
 *   hidden with `hide`. Nothing draws them.
 * - links out of the document. The engine wraps what a `[[url]]` link
 *   draws in an `<a>` whose `title` and `xlink:title` repeat the target,
 *   which `[[url label]]` does not draw. Such an `<a>` is replaced by what
 *   it draws.
 *
 * DOMPurify is deliberately not used here: under happy-dom its
 * innerHTML-based parsing mangles SVG structure (the root `<svg>` element
 * disappears and sibling shapes are dropped — verified empirically).
 * Walking a tree parsed as `image/svg+xml` keeps the document intact.
 */

/** Local names, the part after any prefix (see {@link localPart}). */
const DANGEROUS_ELEMENTS = new Set([
  'script', 'foreignobject', 'iframe', 'embed', 'object',
  'style', 'meta', 'link', 'base',
]);
const LINK_ATTRIBUTES = new Set(['href', 'src']);

/**
 * Attributes a browser reads as CSS that can take a URL: `style`, and the
 * presentation attributes that accept one.
 */
const CSS_ATTRIBUTES = new Set([
  'style', 'fill', 'stroke', 'filter', 'clip-path', 'mask',
  'marker-start', 'marker-mid', 'marker-end', 'cursor',
]);

/** A reference to an element of the document itself: `url(#id)`. */
const FRAGMENT_URL = /url\(\s*(['"]?)#[^'"()\\\s]*\1\s*\)/gi;

/**
 * Whether a CSS value can reach outside the document. CSS loads a resource
 * only through a function — `url()`, `image-set()` and the like — and a
 * function needs a `(` as written: an escaped one is part of a name. So a
 * value with no `(` but those of fragment references reaches nothing,
 * however the rest of it is escaped.
 */
function reachesOutside(value: string): boolean {
  return value.replace(FRAGMENT_URL, '').includes('(');
}

/**
 * The part of an element or attribute name after its prefix, in lower
 * case. What markup is depends on its namespace, not on the prefix that
 * spells it: with `xmlns:s` bound to SVG, `<s:script>` is a script, and so
 * is `<h:script>` with `h` bound to XHTML; with `x` bound to xlink,
 * `x:href` is a link. A browser that opens an exported SVG runs and
 * follows them. happy-dom resolves the prefix of an element but of no
 * attribute save `xlink:` and `xmlns:`, so names are judged by their local
 * part, whatever the prefix and whatever it is bound to.
 */
function localPart(name: string): string {
  return name.slice(name.lastIndexOf(':') + 1).toLowerCase();
}

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
  return localPart(element.nodeName) === 'image' && attributeName !== 'src' && isInlinePng(value);
}

/** DOM node types the walk distinguishes (standard `Node.nodeType` values). */
const ELEMENT_NODE = 1;
const PROCESSING_INSTRUCTION_NODE = 7;
const COMMENT_NODE = 8;

/** Node shape shared by happy-dom's element, text, comment and PI classes. */
interface NodeLike {
  nodeType: number;
  remove(): void;
}

/** Element shape shared by happy-dom's HTML and XML element classes. */
interface ElementLike extends NodeLike {
  nodeName: string;
  childNodes: ArrayLike<NodeLike>;
  attributes: ArrayLike<{ name: string; value: string }>;
  removeAttribute(name: string): void;
  setAttribute(name: string, value: string): void;
  replaceWith(...nodes: NodeLike[]): void;
}

/** An `<a>` leading out of the document (see the module comment). */
function isOutboundLink(element: ElementLike): boolean {
  return (
    localPart(element.nodeName) === 'a' &&
    Array.from(element.attributes).some(
      (attribute) => LINK_ATTRIBUTES.has(localPart(attribute.name)) && !attribute.value.startsWith('#')
    )
  );
}

/** Whether any attribute that survived stripping uses the xlink prefix. */
interface StripState {
  xlink: boolean;
}

function stripAttributes(element: ElementLike, state: StripState): void {
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    // A namespace declaration is not judged by its prefix: removing one
    // would leave the names that use it undeclared.
    if (name === 'xmlns' || name.startsWith('xmlns:')) {
      continue;
    }
    const local = localPart(name);
    if (local.startsWith('on') || local.startsWith('data-')) {
      element.removeAttribute(attribute.name);
    } else if (
      LINK_ATTRIBUTES.has(local) &&
      !attribute.value.startsWith('#') &&
      !isSpritePng(element, local, attribute.value)
    ) {
      element.removeAttribute(attribute.name);
    } else if (CSS_ATTRIBUTES.has(local) && reachesOutside(attribute.value)) {
      element.removeAttribute(attribute.name);
    } else if (name.startsWith('xlink:')) {
      state.xlink = true;
    }
  }
}

function walk(element: ElementLike, state: StripState): void {
  // childNodes rather than children: the embedded source is a processing
  // instruction, which is a node but not an element.
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === PROCESSING_INSTRUCTION_NODE || node.nodeType === COMMENT_NODE) {
      node.remove();
      continue;
    }
    if (node.nodeType !== ELEMENT_NODE) {
      continue;
    }
    const child = node as ElementLike;
    if (DANGEROUS_ELEMENTS.has(localPart(child.nodeName))) {
      child.remove();
      continue;
    }
    if (isOutboundLink(child)) {
      walk(child, state);
      child.replaceWith(...Array.from(child.childNodes));
      continue;
    }
    stripAttributes(child, state);
    walk(child, state);
  }
}

const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';

/**
 * The characters XML 1.0 does not allow: the C0 controls other than tab,
 * line feed and carriage return, U+FFFE, U+FFFF and, with the `u` flag, a
 * surrogate without its pair. The engine draws the characters of a label
 * as they are, in its text or in a tooltip's attributes, and the
 * serialiser writes them out as they are.
 */
// eslint-disable-next-line no-control-regex -- the control characters are what it finds.
const NOT_IN_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/gu;

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
  const rootElement = root as unknown as ElementLike;
  const state: StripState = { xlink: false };
  stripAttributes(rootElement, state);
  walk(rootElement, state);

  // The engine writes `xlink:href` on sprites without ever declaring the
  // prefix. As HTML injected into the preview that parses fine; as a
  // standalone .svg file it is a fatal XML error — a browser shows a
  // broken image for the whole file. Declare the namespace whenever a
  // surviving attribute needs it.
  if (
    state.xlink &&
    !Array.from(rootElement.attributes).some((a) => a.name.toLowerCase() === 'xmlns:xlink')
  ) {
    rootElement.setAttribute('xmlns:xlink', XLINK_NAMESPACE);
  }

  // One such character makes the whole file unreadable as XML: a browser
  // shows a broken image for it, and the PNG export and the .puml preview,
  // which load the SVG as an image, fail on it. Each becomes U+FFFD, the
  // replacement character, as an unpaired surrogate already does when the
  // SVG is written out as UTF-8. The layout made room for it (see
  // measureTextWidth), and the mark shows where the character was.
  return new window.XMLSerializer().serializeToString(root).replace(NOT_IN_XML, '\ufffd');
}
