/**
 * Which local include paths may be looked up, judged from the path's text
 * alone, before any file is touched.
 *
 * A local `!include` names a file relative to the file it is written in.
 * Anything that could name a file elsewhere is refused rather than
 * resolved: a rooted path, a drive, a share, a URI or a home directory. So
 * are names that Windows reads differently from what they say — a reserved
 * device name, a trailing dot or space, an alternate data stream — and the
 * folders of version control. Whether what is left stays inside the
 * workspace folder is decided against real paths (resolver.ts, reader.ts).
 *
 * `\` separates names as `/` does. Nothing is decoded: `%2f` is three
 * characters of a name, and no environment variable is expanded.
 */

/** Extensions an included file may have, compared without regard to case. */
export const INCLUDE_EXTENSIONS: readonly string[] = ['.puml', '.plantuml', '.pu', '.iuml', '.wsd', '.inc', '.txt'];

/** Why a path is refused before any file is looked at. */
export type PathRefusal =
  /** Nothing to look up. */
  | 'empty'
  /** A control character, NUL among them. */
  | 'control'
  /** `~` or `~name`, which a shell would expand to a home directory. */
  | 'home'
  /** Rooted, on a drive or on a share: `/x`, `C:\x`, `C:x`, `\\server\x`. */
  | 'absolute'
  /** A URI or a URL: `file:…`, `https:…`. */
  | 'uri'
  /** A `:` within a name, which on Windows names an alternate data stream. */
  | 'stream'
  /** A name Windows keeps for a device, such as `CON` or `nul.txt`. */
  | 'device'
  /** A name ending in a dot or a space, which Windows drops. */
  | 'trailing'
  /** A `.git`, `.hg` or `.svn` folder. */
  | 'vcs'
  /** A file whose extension is not one of {@link INCLUDE_EXTENSIONS}. */
  | 'extension';

/** A path that may be looked up. */
export interface RelativePath {
  /** Its names in order, `.` dropped and `..` kept. */
  segments: string[];
  /** Written as `./…` or `../…`: looked up next to the including file only. */
  anchored: boolean;
}

export type ParsedPath = { ok: true; path: RelativePath } | { ok: false; refusal: PathRefusal };

const DRIVE = /^[A-Za-z]:/;
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
/** With any extension: `nul.txt` and `nul.tar.gz` are `NUL` too. */
const DEVICE = /^(?:con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(?:\..*)?$/i;
const VCS = /^\.(?:git|hg|svn)$/i;

function hasControlCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function parse(written: string, kind: 'file' | 'folder'): ParsedPath {
  const refuse = (refusal: PathRefusal): ParsedPath => ({ ok: false, refusal });
  if (kind === 'file' && written.trim() === '') {
    return refuse('empty');
  }
  if (hasControlCharacter(written)) {
    return refuse('control');
  }
  const path = written.replace(/\\/g, '/');
  if (path.startsWith('~')) {
    return refuse('home');
  }
  // A single letter before the colon is a drive, not a scheme.
  if (DRIVE.test(path) || path.startsWith('/')) {
    return refuse('absolute');
  }
  if (SCHEME.test(path)) {
    return refuse('uri');
  }
  if (path.includes(':')) {
    return refuse('stream');
  }

  const segments: string[] = [];
  for (const name of path.split('/')) {
    if (name === '' || name === '.') {
      continue;
    }
    if (name !== '..') {
      if (/[ .]$/.test(name)) {
        return refuse('trailing');
      }
      if (DEVICE.test(name)) {
        return refuse('device');
      }
      if (VCS.test(name)) {
        return refuse('vcs');
      }
    }
    segments.push(name);
  }

  if (kind === 'file') {
    const last = (segments.at(-1) ?? '').toLowerCase();
    const named = INCLUDE_EXTENSIONS.some((extension) => last.endsWith(extension) && last.length > extension.length);
    if (!named) {
      return refuse('extension');
    }
  }
  return { ok: true, path: { segments, anchored: /^\.\.?\//.test(path) } };
}

/** Parses the path a `!include` asks for, as the engine hands it over. */
export function parseIncludePath(written: string): ParsedPath {
  return parse(written, 'file');
}

/**
 * Parses a folder of `plantumlLocal.includePaths`, relative to the
 * workspace folder. Empty and `.` name the workspace folder itself.
 */
export function parseSearchFolder(written: string): ParsedPath {
  return parse(written, 'folder');
}
