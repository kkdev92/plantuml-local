/**
 * The PlantUML standard libraries bundled with the extension, which
 * scripts/generate-stdlib.mjs writes to assets/stdlib/. The worker serves
 * these and no other; what the Problems panel and the preview say about a
 * library comes from the same table.
 */
export interface BundledLibrary {
  /** The name the engine looks the library up by: lower-cased. */
  readonly name: string;
  /** The name as diagrams and messages write it. */
  readonly label: string;
  /**
   * The files bundled, as an include names them, when only some of the
   * library's files are; absent when all of them are.
   */
  readonly files?: readonly string[];
  /**
   * Whether its colours are made for a white page, the same in either
   * palette: a diagram that includes it and picks no theme is then drawn in
   * the light palette (src/render/palette.ts). Measured for each library,
   * in the dark palette.
   */
  readonly forWhitePage: boolean;
}

export const BUNDLED_LIBRARIES: readonly BundledLibrary[] = [
  { name: 'azure', label: 'azure', forWhitePage: true },
  {
    name: 'c4',
    label: 'C4',
    files: ['C4', 'C4_Context', 'C4_Container', 'C4_Component', 'C4_Dynamic', 'C4_Deployment', 'C4_Sequence'],
    forWhitePage: true,
  },
];

/** The bundled library an include names, in whatever case; undefined for one that is not bundled. */
export function bundledLibrary(name: string): BundledLibrary | undefined {
  const lowered = name.toLowerCase();
  return BUNDLED_LIBRARIES.find((library) => library.name === lowered);
}
