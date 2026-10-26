/**
 * Where a line of a diagram's source is in its document. A Markdown block's
 * source has the block's container — the quote markers and indentation of
 * the quote or list item it is in — taken off each line, so a column of the
 * source lies that much further right in the document, on the lines that
 * carry the container; a line without it (a lazy continuation) is as it is.
 * The diagnostics, the colours and anything else that points into a block
 * convert through here, so they agree.
 */

/** The document line of line `index` of a block's source, which starts on `sourceLine`. */
export function documentLineOf(sourceLine: number, index: number): number {
  return sourceLine + index;
}

/**
 * The document column of `column` of a source line whose document line is
 * `documentLine`, inside a block whose container is `container`.
 */
export function documentColumnOf(documentLine: string, container: string, column: number): number {
  return (documentLine.startsWith(container) ? container.length : 0) + column;
}
