/** Localises known renderer errors and warnings, preserving unknown details. */
export interface MessageLocalizer {
  t(message: string, ...args: string[]): string;
}

/** English fallback for the renderer when it runs without VS Code. */
export const englishMessages: MessageLocalizer = {
  t: (message, ...args) => message.replace(/\{(\d+)\}/g, (placeholder, index: string) => args[Number(index)] ?? placeholder),
};

/** Separates the location added by recognizeEngineError, including parentheses in a path. */
export function splitErrorLocation(message: string): { detail: string; origin: string; line: string } | null {
  const line = /, line (\d+)\)$/.exec(message);
  if (line === null) {
    return null;
  }
  let depth = 0;
  for (let index = message.length - 1; index >= 0; index -= 1) {
    if (message[index] === ')') {
      depth += 1;
    }
    if (message[index] !== '(') {
      continue;
    }
    depth -= 1;
    if (depth !== 0) {
      continue;
    }
    if (index === 0 || message[index - 1] !== ' ') {
      return null;
    }
    return {
      detail: message.slice(0, index - 1),
      origin: message.slice(index + 1, line.index),
      line: line[1] ?? '',
    };
  }
  return null;
}

export function errorMessage(message: string, l10n: MessageLocalizer): string {
  const detail = message.replace(/^java\.lang\.RuntimeException: /, '');
  // recognizeEngineError appends the source location for an included file.
  // Translate the explanation without losing the file name or line number.
  const location = splitErrorLocation(detail);
  const original = location?.detail ?? detail;
  const translated = translateDetail(original, l10n);
  if (translated === original) {
    return message;
  }
  return location === null
    ? translated
    : l10n.t('{0} ({1}, line {2})', translated, location.origin, location.line);
}

function translateDetail(detail: string, l10n: MessageLocalizer): string {
  switch (detail) {
    case 'Rendering timed out':
      return l10n.t('Rendering timed out. Try simplifying the diagram or reducing the number of included files.');
    case 'Render worker exited':
      return l10n.t('The diagram renderer stopped unexpectedly. Run "PlantUML Local: Clear Render Cache and Re-render" to try again.');
    case 'Extension deactivated':
      return l10n.t('Rendering stopped because PlantUML Local was deactivated.');
    case 'PlantUML rendering failed':
      return l10n.t('PlantUML could not render this diagram. Check its source code and try again.');
    case 'PlantUML did not return an SVG document':
      return l10n.t('PlantUML did not return a valid diagram image. Try rendering the diagram again.');
    case 'PNG encoding failed':
      return l10n.t('The PNG could not be created. Try exporting as SVG.');
    case 'No diagram found':
      return l10n.t('No diagram found. Add diagram content between the start and end lines.');
    case 'Syntax error!':
    case 'Syntax Error?':
      return l10n.t('Syntax error. Check the diagram source.');
    case 'Cannot import':
      return l10n.t('!import is not supported by this extension. Use !include to load a PlantUML file from your workspace.');
    // The browser build's answer for the diagram types it leaves out (ditaa, for one).
    case 'Unsupported diagram type':
      return l10n.t('This diagram type is not supported by the bundled version of PlantUML.');
    case 'Infinite loop?':
      return l10n.t('A !while or !foreach loop repeated too many times and was stopped. Check the loop condition.');
  }

  // The engine loads the files a drawing missed and draws again, at most so
  // many times. As of 1.2026.9 each drawing stops at the first file missing,
  // so the limit counts included files, not only levels (plantuml/plantuml#2943).
  const rounds = /^Rendering abandoned after (\d+) rounds of loading resources; still missing: /.exec(detail);
  if (rounds !== null) {
    return l10n.t(
      'The bundled PlantUML loads the files a diagram includes one at a time and stops after {0}. This diagram includes more files than that, counting nested includes. Reduce the number of included files.',
      rounds[1] ?? ''
    );
  }
  if (/^Network access is disabled in the PlantUML render worker \(.+\)$/.test(detail)) {
    return l10n.t('Network access was blocked while rendering this diagram. Use files in your workspace or bundled libraries and themes.');
  }
  if (detail.startsWith('Diagram too large for browser rendering')) {
    const size = /(\d+)x(\d+) \(max (\d+)/.exec(detail);
    return size === null
      ? l10n.t('The diagram exceeds the maximum size of 8192 pixels in width or height.')
      : l10n.t('The diagram is {0} × {1} pixels. The maximum width or height is {2} pixels. Reduce the diagram size.', size[1] ?? '', size[2] ?? '', size[3] ?? '');
  }
  if (/^Empty description(?: \(Assumed diagram type: .+\))?$/.test(detail)) {
    return l10n.t('No diagram found. Add diagram content between the start and end lines.');
  }
  const syntax = /^Syntax Error\? \(Assumed diagram type: (.+)\)$/.exec(detail);
  if (syntax !== null) {
    return l10n.t(
      'Syntax error. Detected diagram type: {0}. Check the syntax for that type.',
      diagramTypeName(syntax[1] ?? '', l10n)
    );
  }
  const data = /^Your data does not sound like (\S+) data$/.exec(detail);
  if (data !== null) {
    return l10n.t('Invalid {0} data. Check the data syntax.', data[1] ?? '');
  }
  const unsupported = /^Diagram not supported by this release of PlantUML(?:: "(.+)" is not recognized)?$/.exec(detail);
  if (unsupported !== null) {
    return unsupported[1] === undefined
      ? l10n.t('This diagram type is not supported by the bundled version of PlantUML.')
      : l10n.t('The bundled version of PlantUML does not support {0}.', unsupported[1]);
  }

  const deprecated = /^This syntax is deprecated, you must add (.+) at the end of the line, after the ';'$/.exec(detail);
  if (deprecated !== null) {
    return l10n.t('This syntax is deprecated. Add {0} after the semicolon at the end of the line.', deprecated[1] ?? '');
  }

  // Include failure reasons have already been localised by the include loader.
  const library = /^cannot include <([^/>]+)/.exec(detail)?.[1];
  if (library !== undefined && library.toLowerCase() !== 'azure') {
    return l10n.t('The {0} standard library is not included with this extension. Only the azure library is available.', library);
  }
  const include = /^cannot include (.+?)(?:: (.+))?$/.exec(detail);
  if (include !== null) {
    const reference = include[1] ?? '';
    if (include[2] === undefined && reference.includes('!')) {
      return l10n.t('Could not include {0}. Check the file path and the diagram or section selected after "!".', reference);
    }
    // A local file the host gave no reason for is one the engine did not ask
    // it for, as with `!includeurl file.puml`.
    if (include[2] === undefined && !reference.startsWith('<')) {
      return l10n.t('Could not include {0}. Use !include with a file in your workspace.', reference);
    }
    return include[2] === undefined
      ? l10n.t('Could not include {0}. Check the file path or library name.', reference)
      : l10n.t('Could not include {0}: {1}', reference, include[2]);
  }
  const theme = /^Cannot load theme (\S+) in (.+?)(?:: (.+))?$/.exec(detail);
  if (theme !== null) {
    return theme[3] === undefined
      ? l10n.t('Could not load theme {0} from {1}. Check the theme name and folder.', theme[1] ?? '', theme[2] ?? '')
      : l10n.t('Could not load theme {0} from {1}: {2}', theme[1] ?? '', theme[2] ?? '', theme[3]);
  }
  const missingTheme = /^Cannot load theme (\S+)$/.exec(detail);
  if (missingTheme !== null) {
    return l10n.t('Theme {0} is not available. Check the name or choose a bundled theme.', missingTheme[1] ?? '');
  }
  return detail;
}

/** The common diagram types in engine errors; unknown type names stay intact. */
function diagramTypeName(type: string, l10n: MessageLocalizer): string {
  switch (type) {
    case 'sequence': return l10n.t('Sequence diagram');
    case 'class': return l10n.t('Class diagram');
    case 'activity': return l10n.t('Activity diagram');
    case 'state': return l10n.t('State diagram');
    case 'component': return l10n.t('Component diagram');
    case 'usecase': return l10n.t('Use case diagram');
    default: return type;
  }
}
