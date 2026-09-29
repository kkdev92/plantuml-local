import { activityCases } from './activity';
import { builtinCases } from './builtins';
import { chartCases } from './chart';
import { classCases } from './classes';
import { commonCases } from './common';
import { creoleCases } from './creole';
import { dataCases } from './data';
import { descriptionCases } from './description';
import { documentCases } from './documents';
import { ganttCases } from './gantt';
import { interplayCases, letterCaseCases, whitespaceCases } from './interplay';
import { networkCases } from './network';
import { outlineCases } from './outline';
import { preprocessorCases } from './preprocessor';
import { sequenceCases } from './sequence';
import { stateCases } from './state';
import { syntaxCases } from './syntax';
import { timingCases } from './timing';
import type { GrammarCase } from './types';

export type { GrammarCase } from './types';

/** Every grammar case, grouped by the file that defines it. */
export const caseGroups: Record<string, GrammarCase[]> = {
  preprocessor: preprocessorCases,
  builtins: builtinCases,
  common: commonCases,
  creole: creoleCases,
  sequence: sequenceCases,
  classes: classCases,
  description: descriptionCases,
  activity: activityCases,
  state: stateCases,
  timing: timingCases,
  gantt: ganttCases,
  chart: chartCases,
  outline: outlineCases,
  network: networkCases,
  syntax: syntaxCases,
  data: dataCases,
  documents: documentCases,
  interplay: interplayCases,
  whitespace: whitespaceCases,
  'letter case': letterCaseCases,
};

export const allCases: GrammarCase[] = Object.values(caseGroups).flat();
