/**
 * @startsalt: wireframes (PSystemSaltFactory). The engine reads the common
 * commands (title, skinparam, scale …) and hands every other line to the
 * widget parser whole (CommandAnything), so widget lines are left as text,
 * with their creole markup.
 */

import { include, type Rule } from './rules';

export const saltRepository: Record<string, Rule> = {
  'diagram-salt': {
    patterns: [include('preprocessor'), include('common-commands'), include('label')],
  },
};
