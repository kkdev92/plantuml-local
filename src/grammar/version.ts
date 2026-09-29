/**
 * The information diagrams of @startuml: a single `version`, `author`,
 * `authors` or `about` line (PSystemVersionFactory; the browser build has
 * no stdlib, testdot or key commands).
 */

import { BOL, SP, named, re, type Rule } from './rules';

export const versionRepository: Record<string, Rule> = {
  version: {
    match: re`(?i)${BOL}\s*(version|authors?|about)${SP}*$`,
    captures: { 1: named('keyword.other') },
  },
};
