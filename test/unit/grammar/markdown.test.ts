import { describe, expect, it } from 'vitest';

import { allCases } from './cases';
import { checkScopes, MARKDOWN_SCOPE, tokenize, type Expectation } from './harness';

/**
 * The injection gives the PlantUML grammar to exactly the fences the
 * preview renders: markdown-it fences whose info string starts with the
 * word `plantuml` (src/preview/plugin.ts), inside VS Code's Markdown
 * grammar (the 1.138.0 fixture).
 */

const EMBEDDED = 'meta.embedded.block.plantuml';
const DIAGRAM = `${EMBEDDED} keyword.control.diagram`;
const PLAIN = `!${EMBEDDED}`;

async function expectMarkdown(markdown: string, expectations: readonly Expectation[]): Promise<void> {
  expect(await checkScopes(markdown, expectations, MARKDOWN_SCOPE)).toEqual([]);
}

const diagram = '@startuml\nAlice -> Bob : hi\n@enduml';

describe('markdown injection', () => {
  it('highlights a backtick fence', async () => {
    await expectMarkdown(`Text\n\n\`\`\`plantuml\n${diagram}\n\`\`\`\n\nAfter`, [
      ['plantuml', 'fenced_code.block.language.markdown'],
      ['@startuml', DIAGRAM],
      ['->', `${EMBEDDED} keyword.operator.arrow`],
      ['@enduml', DIAGRAM],
      ['After', PLAIN],
    ]);
  });

  it('highlights a tilde fence and a longer fence', async () => {
    await expectMarkdown(`~~~plantuml\n${diagram}\n~~~\n\n\`\`\`\`plantuml\n${diagram}\n\`\`\`\`\``, [
      ['@startuml', DIAGRAM],
      ['@enduml', DIAGRAM],
      ['@startuml', DIAGRAM],
      ['@enduml', DIAGRAM],
    ]);
  });

  it('accepts attributes after the language, as the preview does', async () => {
    await expectMarkdown(`\`\`\` plantuml {#flow title="Flow"}\n${diagram}\n\`\`\``, [
      ['{#flow title="Flow"}', 'fenced_code.block.language.attributes.markdown'],
      ['@startuml', DIAGRAM],
    ]);
  });

  it('leaves alone the fences the preview does not render', async () => {
    for (const info of ['puml', 'PlantUML', 'plantumlx', 'plantuml{x}', 'uml']) {
      await expectMarkdown(`\`\`\`${info}\n${diagram}\n\`\`\``, [['@startuml', PLAIN]]);
    }
  });

  it('does not treat a backtick run with a backtick in its info string as a fence', async () => {
    await expectMarkdown(`\`\`\`plantuml \`x\`\n${diagram}\n\`\`\``, [['@startuml', PLAIN]]);
  });

  it('highlights fences inside list items and block quotes', async () => {
    await expectMarkdown(
      `- item\n\n  \`\`\`plantuml\n  ${diagram.replace(/\n/g, '\n  ')}\n  \`\`\`\n\n> \`\`\`plantuml\n> @startuml\n> Alice -> Bob\n> @enduml\n> \`\`\``,
      [
        ['@startuml', DIAGRAM],
        ['@enduml', DIAGRAM],
        ['@startuml', DIAGRAM],
        ['->', `${EMBEDDED} keyword.operator.arrow`],
        ['@enduml', DIAGRAM],
      ]
    );
  });

  it('leaves alone a plantuml fence shown inside another code block', async () => {
    await expectMarkdown(`\`\`\`\`markdown\n\`\`\`plantuml\n${diagram}\n\`\`\`\n\`\`\`\``, [['@startuml', PLAIN]]);
  });

  it('runs an unclosed fence to the end of the document', async () => {
    await expectMarkdown(`\`\`\`plantuml\n${diagram}\n\n# Not a heading`, [
      ['@enduml', DIAGRAM],
      ['# Not a heading', EMBEDDED],
    ]);
  });

  it('returns to Markdown after the closing fence', async () => {
    const { endDepth } = await tokenize(`\`\`\`plantuml\n${diagram}\n\`\`\`\n`, MARKDOWN_SCOPE);
    await expectMarkdown(`\`\`\`plantuml\n${diagram}\n\`\`\`\n# Heading`, [
      ['# Heading', `${PLAIN} markup.heading.markdown`],
    ]);
    expect(endDepth).toBe(1);
  });

  it('gives every grammar case the same scopes inside a fence', async () => {
    const failures: string[] = [];
    for (const c of allCases) {
      const markdown = `Text before.\n\n\`\`\`plantuml\n${c.source}\n\`\`\`\n`;
      for (const failure of await checkScopes(markdown, c.expect, MARKDOWN_SCOPE)) {
        failures.push(`${c.name}: ${failure}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('gives every grammar case the same scopes inside a fence in a block quote', async () => {
    const failures: string[] = [];
    for (const c of allCases) {
      const quoted = `\`\`\`plantuml\n${c.source}\n\`\`\``.replace(/^/gm, '> ');
      // Texts spanning lines do not occur verbatim once each line has its
      // `> `, and a lone `>` would be found in the quote markers.
      const expectations = c.expect.filter(([text]) => !text.includes('\n') && text !== '>');
      for (const failure of await checkScopes(`${quoted}\n`, expectations, MARKDOWN_SCOPE)) {
        failures.push(`${c.name}: ${failure}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('gives every grammar case the same scopes inside a fence in a list item', async () => {
    const failures: string[] = [];
    for (const c of allCases) {
      const indented = `\`\`\`plantuml\n${c.source}\n\`\`\``.replace(/^/gm, '   ');
      const expectations = c.expect.filter(([text]) => !text.includes('\n'));
      for (const failure of await checkScopes(`1. Step\n\n${indented}\n`, expectations, MARKDOWN_SCOPE)) {
        failures.push(`${c.name}: ${failure}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('ends the diagram at the fence even when a construct is left open', async () => {
    await expectMarkdown(`\`\`\`plantuml\n@startuml\nnote left of A\n  never closed\n\`\`\`\n# Heading`, [
      ['# Heading', `${PLAIN} markup.heading.markdown`],
    ]);
  });
});

describe('markdown injection after another grammar has claimed every fence', () => {
  // The catch-all is registered first, so it wins the fence line; the
  // diagram is picked up inside the block it opened.
  async function expectClaimed(markdown: string, expectations: readonly Expectation[]): Promise<void> {
    expect(await checkScopes(markdown, expectations, MARKDOWN_SCOPE, true)).toEqual([]);
  }

  it('lets the catch-all take the fence line', async () => {
    // Without this the tests below would pass on the ordinary injection.
    await expectClaimed(`\`\`\`plantuml\n${diagram}\n\`\`\``, [
      ['plantuml', '!fenced_code.block.language.markdown'],
    ]);
  });

  it('still highlights the diagram, with backticks, tildes, attributes and indentation', async () => {
    await expectClaimed(
      `\`\`\`plantuml\n${diagram}\n\`\`\`\n\n~~~~ plantuml name\n${diagram}\n~~~~\n\n  \`\`\`plantuml\n  ${diagram.replace(/\n/g, '\n  ')}\n  \`\`\``,
      [
        ['@startuml', DIAGRAM],
        ['->', `${EMBEDDED} keyword.operator.arrow`],
        ['@enduml', DIAGRAM],
        ['@startuml', DIAGRAM],
        ['@enduml', DIAGRAM],
        ['@startuml', DIAGRAM],
        ['@enduml', DIAGRAM],
      ]
    );
  });

  it('leaves alone the fences the preview does not render', async () => {
    await expectClaimed(
      `\`\`\`puml\n${diagram}\n\`\`\`\n\n\`\`\`plantumlx\n${diagram}\n\`\`\`\n\n\`\`\`js\nplantuml\n@startuml\n\`\`\``,
      [
        ['@startuml', PLAIN],
        ['@startuml', PLAIN],
        ['plantuml', PLAIN],
        ['@startuml', PLAIN],
      ]
    );
  });

  it('leaves alone a plantuml fence shown inside another code block or an HTML comment', async () => {
    await expectClaimed(`\`\`\`\`markdown\n\`\`\`plantuml\n${diagram}\n\`\`\`\n\`\`\`\``, [['@startuml', PLAIN]]);
    await expectClaimed(`<!--\n\`\`\`plantuml\n${diagram}\n\`\`\`\n-->`, [['@startuml', PLAIN]]);
  });

  it('closes the fence in list items and block quotes, and returns to Markdown', async () => {
    await expectClaimed(
      `- item\n\n  \`\`\`plantuml\n  ${diagram.replace(/\n/g, '\n  ')}\n  \`\`\`\n\n> \`\`\`plantuml\n> @startuml\n> Alice -> Bob\n> @enduml\n> \`\`\`\n\n# Heading`,
      [
        ['@startuml', DIAGRAM],
        ['@enduml', DIAGRAM],
        ['```', `${PLAIN} punctuation.definition.markdown`],
        ['@startuml', DIAGRAM],
        ['@enduml', DIAGRAM],
        ['```', `${PLAIN} punctuation.definition.markdown`],
        ['# Heading', `${PLAIN} markup.heading.markdown`],
      ]
    );
    const { endDepth } = await tokenize(`\`\`\`plantuml\n${diagram}\n\`\`\`\n`, MARKDOWN_SCOPE, true);
    expect(endDepth).toBe(1);
  });

  it('gives every grammar case the same scopes inside a claimed fence', async () => {
    const failures: string[] = [];
    for (const c of allCases) {
      const markdown = `Text before.\n\n\`\`\`plantuml\n${c.source}\n\`\`\`\n`;
      for (const failure of await checkScopes(markdown, c.expect, MARKDOWN_SCOPE, true)) {
        failures.push(`${c.name}: ${failure}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
