/**
 * Splits text into lines the way the editor counts them: a line ends at
 * CR LF, at LF, or at a lone CR.
 *
 * Text that comes from an open document never holds a lone CR, as VS Code
 * settles on one line ending when it opens a file. Text read from disk can:
 * a file the folder export reads without opening it, a file an include
 * pulls in, a theme read from a folder. Splitting those the same way keeps
 * the extension's line numbers equal to the ones the editor would show for
 * the file, and keeps a diagram per start line where the engine, which also
 * reads a lone CR as a line break, would see one.
 */
export function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}
