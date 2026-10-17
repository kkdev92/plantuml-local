import { uml, type GrammarCase } from './types';

export const saltCases: GrammarCase[] = [
  {
    name: 'a wireframe: the common commands, and widget lines left as text',
    covers: ['command:CommandAnything'],
    source: uml`
      @startsalt
      title Sign in
      {
        Login    | "MyName   "
        Password | "****     "
        [Cancel] | [ **OK** ]
      }
      @endsalt
    `,
    expect: [
      ['salt', 'keyword.control.diagram !invalid'],
      ['title', 'keyword.other'],
      ['Sign in', '!keyword'],
      ['Login', '!keyword !entity'],
      ['[Cancel]', '!keyword !entity'],
      ['OK', 'markup.bold'],
      ['@end', 'keyword.control.diagram'],
      ['salt', 'keyword.control.diagram !invalid'],
    ],
  },
];
