import { runInNewContext } from 'node:vm';

/**
 * The names of the properties and the selectors of a `<style>` block, as
 * the bundled engine knows them: the constants of its enums PName and
 * SName, read from its plantuml.js. scripts/build.mjs writes them to
 * dist/engine/style-names.json, from which the completion and the hovers
 * take the names they show, in the engine's spelling.
 *
 * plantuml.js is PlantUML compiled from Java: its strings sit in one array,
 * which a function `(strings) => …` loads and `(index) => …` reads, and an
 * enum makes each of its constants by calling one function with the read
 * string and the constant's ordinal, counting from 0 in the order the Java
 * source declares them. The two enums are the ones whose constants include
 * the names below; if no enum, or more than one, does, the format has
 * changed and the build stops.
 */
const ANCHORS = {
  properties: ['FontName', 'BackGroundColor', 'LineThickness'],
  selectors: ['element', 'sequenceDiagram', 'participant', 'classDiagram'],
};

/** `name` for a regular expression: a minified name may hold `$`. */
const literal = (name) => name.replace(/\$/g, '\\$');

/** The strings of the engine's string pool, in their order. */
function stringPool(script) {
  const read = /([\w$]+)=index=>([\w$]+)\[index\]/.exec(script);
  const load = read && new RegExp(String.raw`([\w$]+)=strings=>\{[^}]*\b${literal(read[2])}=new Array\(strings\.length\)`).exec(script);
  const open = load ? script.indexOf(`${load[1]}([`) : -1;
  if (read === null || open === -1) {
    throw new Error('plantuml.js: no string pool found — has its format changed?');
  }
  // Each element is a string literal, maybe split over lines with `+`.
  let at = open + load[1].length + 1;
  const start = at;
  at += 1;
  for (;;) {
    const char = script[at];
    if (char === ']') {
      break;
    }
    if (char === '"' || char === "'") {
      at += 1;
      while (script[at] !== char) {
        at += script[at] === '\\' ? 2 : 1;
      }
    } else if (char !== ',' && char !== '+' && char !== '\n') {
      throw new Error(`plantuml.js: unexpected ${JSON.stringify(script.slice(at, at + 20))} in the string pool`);
    }
    at += 1;
  }
  return { reader: read[1], strings: runInNewContext(script.slice(start, at + 1)) };
}

/** The names of the constants of each enum, in their order. */
function enumConstants(script, { reader, strings }) {
  const made = new RegExp(String.raw`([\w$]+)\(${literal(reader)}\((\d+)\),\s*(\d+)\)`, 'g');
  const enums = [];
  let current = null;
  for (const [, make, index, ordinal] of script.matchAll(made)) {
    if (ordinal === '0') {
      current = { make, names: [] };
      enums.push(current.names);
    } else if (current?.make !== make || Number(ordinal) !== current.names.length) {
      continue;
    }
    current.names.push(strings[Number(index)]);
  }
  return enums;
}

/**
 * The names of the properties and the selectors of a style that the engine
 * `script` (its plantuml.js) knows, in the order of its source.
 */
export function readStyleNames(script) {
  const enums = enumConstants(script, stringPool(script));
  const pick = (what) => {
    const found = enums.filter((names) => ANCHORS[what].every((name) => names.includes(name)));
    if (found.length !== 1) {
      throw new Error(`plantuml.js: ${found.length} lists of style ${what} found, not one — has its format changed?`);
    }
    return found[0];
  };
  return { properties: pick('properties'), selectors: pick('selectors') };
}
