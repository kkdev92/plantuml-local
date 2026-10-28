/**
 * A PNG written inline as a data URI: the one image the bundled engine
 * draws (`<img:data:image/png;base64,…>`), and the one image the sanitiser
 * keeps (src/worker/sanitize.ts). One test for both, so that what the
 * Problems panel says is drawn is what the preview shows.
 */

/**
 * Base64 of the eight-byte PNG signature. Those bytes fix the first ten
 * characters of the encoding regardless of what follows, so matching the
 * prefix checks the container without decoding the payload.
 */
export const PNG_SIGNATURE_BASE64 = 'iVBORw0KGg';

/** Nothing outside the base64 alphabet, so no second URI can be smuggled in. */
const INLINE_PNG = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;

/** Whether `value` is a PNG written inline: base64 and nothing else, starting with the PNG signature. */
export function isInlinePng(value: string): boolean {
  return value.startsWith(`data:image/png;base64,${PNG_SIGNATURE_BASE64}`) && INLINE_PNG.test(value);
}
