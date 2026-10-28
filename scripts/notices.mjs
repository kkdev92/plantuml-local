/**
 * THIRD_PARTY_NOTICES.md, read against the npm packages that ship: each
 * needs a row in the table naming the versions of it that ship, and a row
 * naming an npm package needs that package to ship. scripts/build.mjs runs
 * this after a build, with the packages whose code reaches a bundle and
 * @plantuml/core, whose files are copied into dist/engine/.
 */

/**
 * The rows for what is not an npm package of its own: the parts of
 * @plantuml/core (Viz.js with Graphviz and Expat inside it, the icons and
 * the themes) and the standard libraries baked into dist/stdlib/. The
 * build cannot tell their versions, so these rows are kept by hand.
 */
export const NOT_FROM_NPM = new Set([
  'Viz.js',
  'Graphviz',
  'Expat',
  'Azure-PlantUML',
  'C4-PlantUML',
  'Open Iconic',
  'puml-themes',
  'RedDress-PlantUML',
]);

/**
 * The rows of the notices' table: the component each names (its link
 * text, without backticks) and the versions its Version column lists.
 */
export function noticeRows(markdown) {
  const rows = [];
  for (const line of markdown.split(/\r?\n/)) {
    const cells = /^\|(.*)\|$/.exec(line.trim())?.[1].split('|').map((cell) => cell.trim());
    const name = cells === undefined ? undefined : /^\[`?([^\]`]+)`?\]\(/.exec(cells[0])?.[1];
    if (name !== undefined && cells.length > 1) {
      rows.push({ name, versions: cells[1].split(',').map((version) => version.trim()) });
    }
  }
  return rows;
}

/**
 * What the notices get wrong about `shipped`, a map from each npm package
 * that ships to the set of its versions that do: one sentence for each
 * thing, none when they agree.
 */
export function noticesProblems(markdown, shipped) {
  const rows = noticeRows(markdown);
  if (rows.length === 0) {
    return ['THIRD_PARTY_NOTICES.md has no table of components to read'];
  }
  const problems = [];
  for (const [name, versions] of shipped) {
    const shipping = [...versions].sort().join(', ');
    const row = rows.find((candidate) => candidate.name === name);
    const listed = new Set(row?.versions);
    if (row === undefined) {
      problems.push(`THIRD_PARTY_NOTICES.md has no row for ${name}, of which ${shipping} ships`);
    } else if (listed.size !== versions.size || [...versions].some((version) => !listed.has(version))) {
      problems.push(`THIRD_PARTY_NOTICES.md lists ${name} ${row.versions.join(', ')}, but ${shipping} ships`);
    }
  }
  for (const { name } of rows) {
    if (!shipped.has(name) && !NOT_FROM_NPM.has(name)) {
      problems.push(`THIRD_PARTY_NOTICES.md has a row for ${name}, which does not ship`);
    }
  }
  return problems;
}
