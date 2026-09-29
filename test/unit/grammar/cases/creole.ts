import { uml, type GrammarCase } from './types';

export const creoleCases: GrammarCase[] = [
  {
    name: 'creole markers and their HTML-like equivalents, closed or running to the end of the line',
    covers: [
      'creole:CommandCreoleStyle.createCreole(BOLD)',
      'creole:CommandCreoleStyle.createLegacy(BOLD)',
      'creole:CommandCreoleStyle.createLegacyEol(BOLD)',
      'creole:CommandCreoleStyle.createCreole(ITALIC)',
      'creole:CommandCreoleStyle.createLegacy(ITALIC)',
      'creole:CommandCreoleStyle.createLegacyEol(ITALIC)',
      'creole:CommandCreoleStyle.createLegacy(PLAIN)',
      'creole:CommandCreoleStyle.createLegacyEol(PLAIN)',
      'creole:CommandCreoleStyle.createCreole(UNDERLINE)',
      'creole:CommandCreoleStyle.createLegacy(UNDERLINE)',
      'creole:CommandCreoleStyle.createLegacyEol(UNDERLINE)',
      'creole:CommandCreoleStyle.createCreole(STRIKE)',
      'creole:CommandCreoleStyle.createLegacy(STRIKE)',
      'creole:CommandCreoleStyle.createLegacyEol(STRIKE)',
      'creole:CommandCreoleStyle.createCreole(WAVE)',
      'creole:CommandCreoleStyle.createLegacy(WAVE)',
      'creole:CommandCreoleStyle.createLegacyEol(WAVE)',
      'creole:CommandCreoleStyle.createLegacy(BACKCOLOR)',
      'creole:CommandCreoleStyle.createLegacyEol(BACKCOLOR)',
      'creole:CommandCreoleMonospaced.create',
    ],
    source: uml`
      @startuml
      Alice -> Bob : **bold** <b>bold</b> <b>bold to the end
      Alice -> Bob : //italic// <i>italic</i> <i>italic to the end
      Alice -> Bob : <plain>plain</plain> <plain>plain to the end
      Alice -> Bob : __under__ <u>under</u> <u:red>red under</u> <u>under to the end
      Alice -> Bob : --strike-- <s>strike</s> <del>strike</del> <strike:blue>strike to the end
      Alice -> Bob : ~~wave~~ <w>wave</w> <w:#FF0000>wave to the end
      Alice -> Bob : <back:yellow>highlight</back> <back:#cfc>highlight to the end
      Alice -> Bob : ""monospaced""
      @enduml
    `,
    expect: [
      ['bold', 'markup.bold'],
      ['<b>', 'entity.name.tag.creole'],
      ['bold', 'markup.bold'],
      ['</b>', 'entity.name.tag.creole'],
      ['bold to the end', 'markup.bold'],
      ['italic', 'markup.italic'],
      ['italic', 'markup.italic'],
      ['italic to the end', 'markup.italic'],
      ['<plain>', 'entity.name.tag.creole'],
      ['plain to the end', '!markup.bold !markup.italic !markup.underline !markup.strikethrough'],
      ['under', 'markup.underline'],
      ['under', 'markup.underline'],
      ['red', 'support.constant.color'],
      ['red under', 'markup.underline'],
      ['under to the end', 'markup.underline'],
      ['strike', 'markup.strikethrough'],
      ['strike', 'markup.strikethrough'],
      ['strike', 'markup.strikethrough'],
      ['blue', 'support.constant.color'],
      ['strike to the end', 'markup.strikethrough'],
      ['wave', 'markup.underline.wave'],
      ['wave', 'markup.underline.wave'],
      ['#FF0000', 'constant.other.color'],
      ['wave to the end', 'markup.underline.wave'],
      ['<back:', 'entity.name.tag.creole'],
      ['yellow', 'support.constant.color'],
      ['#cfc', 'constant.other.color'],
      ['monospaced', 'markup.inline.raw'],
    ],
  },
  {
    name: 'creole font changes: size, colour, font, superscript and subscript',
    covers: [
      'creole:CommandCreoleSizeChange.create',
      'creole:CommandCreoleSizeChange.createEol',
      'creole:CommandCreoleColorChange.create',
      'creole:CommandCreoleColorChange.createEol',
      'creole:CommandCreoleColorAndSizeChange.create',
      'creole:CommandCreoleColorAndSizeChange.createEol',
      'creole:CommandCreoleFontFamilyChange.create',
      'creole:CommandCreoleFontFamilyChange.createEol',
      'creole:CommandCreoleExposantChange.create(EXPOSANT)',
      'creole:CommandCreoleExposantChange.create(INDICE)',
    ],
    source: uml`
      @startuml
      Alice -> Bob : <size:18>big</size> <size 9>small to the end
      Alice -> Bob : <color:red>red</color> <color #00F>blue to the end
      Alice -> Bob : <font color=red size=14>font</font> <font size=8>small to the end
      Alice -> Bob : <font:courier>courier</font> <font:serif>serif to the end
      Alice -> Bob : x<sup>2</sup> H<sub>2</sub>O
      @enduml
    `,
    expect: [
      ['<size:', 'entity.name.tag.creole'],
      ['18', 'constant.numeric'],
      ['</size>', 'entity.name.tag.creole'],
      ['9', 'constant.numeric'],
      ['<color:', 'entity.name.tag.creole'],
      ['red', 'support.constant.color'],
      ['#00F', 'constant.other.color'],
      ['size', 'entity.other.attribute-name'],
      ['</font>', 'entity.name.tag.creole'],
      ['<font:courier>', 'entity.name.tag.creole'],
      ['<sup>', 'entity.name.tag.creole'],
      ['</sub>', 'entity.name.tag.creole'],
    ],
  },
  {
    name: 'creole sprites, spacing and links',
    covers: ['creole:CommandCreoleSprite.create', 'creole:CommandCreoleSpace.create', 'creole:CommandCreoleUrl.create'],
    source: uml`
      @startuml
      sprite $dot [4x4/16] {
      F00F
      0FF0
      0FF0
      F00F
      }
      Alice -> Bob : <$dot> <#red$dot{scale=2,color=red}> <$dot*1.5>
      Alice -> Bob : a<space:20>b
      Alice -> Bob : [[https://example.com]] [[https://example.com{tooltip} label]] [["https://example.com" quoted]]
      @enduml
    `,
    expect: [
      ['<$dot>', 'constant.other.symbol.sprite'],
      ['#red', 'constant.other.color'],
      ['dot', 'constant.other.symbol.sprite'],
      ['scale', 'entity.other.attribute-name'],
      ['2', 'constant.numeric'],
      ['dot', 'constant.other.symbol.sprite'],
      ['space', 'entity.name.tag.creole'],
      ['20', 'constant.numeric'],
      ['[[', 'punctuation.definition.link.begin'],
      ['https://example.com', 'markup.underline.link'],
      ['{tooltip}', 'string.unquoted.tooltip'],
      ['"https://example.com"', 'string.quoted.double'],
    ],
  },
  {
    name: 'creole QR codes (not available in the browser engine)',
    covers: ['creole:CommandCreoleQrcode.create'],
    source: uml`
      @startuml
      Alice -> Bob : <qrcode:https://example.com{scale=2}>
      @enduml
    `,
    expect: [
      ['<qrcode:', 'entity.name.tag.creole'],
      ['https://example.com', 'string.unquoted.path'],
      ['{scale=2}', 'constant.numeric.scale'],
    ],
    render: /UnsupportedOperationException/,
  },
  {
    name: 'creole OpenIconic icons',
    covers: ['creole:CommandCreoleOpenIcon.create'],
    source: uml`
      @startuml
      Alice -> Bob : <&star> <#red&heart*2>
      @enduml
    `,
    expect: [
      ['<&star>', 'constant.other.symbol.openiconic'],
      ['#red', 'constant.other.color'],
      ['heart', 'constant.other.symbol.openiconic'],
      ['2', 'constant.numeric'],
    ],
  },
  {
    // The engine loads emoji from emoji.js, which @plantuml/core ships next
    // to plantuml.js but the extension does not bundle.
    name: 'creole emoji (their data file is not bundled)',
    covers: ['creole:CommandCreoleEmoji.create'],
    source: uml`
      @startuml
      Alice -> Bob : <:smile:> <#0000FF:rocket:{scale=0.5}>
      @enduml
    `,
    expect: [
      ['smile', 'constant.other.symbol.emoji'],
      ['#0000FF', 'constant.other.color'],
      ['rocket', 'constant.other.symbol.emoji'],
    ],
    render: /Failed to load emoji\.js/,
  },
  {
    // The lines between {{ and }} are one block for the engine, whatever
    // they say: an `end note` or a `}` inside does not end what is around
    // it. The browser engine draws nothing for the block.
    name: 'embedded diagrams in a note, a class body and a legend',
    covers: [],
    source: uml`
      @startuml
      Alice -> Bob : hi
      note right
      {{
      A -> B : inner
      note left
        inside
      end note
      }}
      end note
      class Order {
        id
      {{wbs
      * root
      }}
        total
      }
      legend
      {{
      class C {
        x
      }
      }}
      {{ uml
      endlegend
      @enduml
    `,
    expect: [
      ['{{', 'punctuation.section.embedded.begin'],
      ['A -> B : inner', 'meta.embedded-diagram !keyword.operator.arrow'],
      ['end note', 'meta.embedded-diagram !keyword.other.note'],
      ['}}', 'punctuation.section.embedded.end'],
      ['end note', 'keyword.other.note !meta.embedded-diagram'],
      ['wbs', 'keyword.control.diagram'],
      ['* root', 'meta.embedded-diagram'],
      ['total', 'variable.other.member'],
      ['}', 'punctuation.section.block.end'],
      ['{{', 'punctuation.section.embedded.begin'],
      ['}', 'meta.embedded-diagram !punctuation.section.block.end'],
      ['{{ uml', '!punctuation.section.embedded.begin'],
      ['endlegend', 'keyword.other'],
    ],
  },
  {
    name: 'creole images (need files: unavailable in the browser engine)',
    covers: ['creole:CommandCreoleImg.create'],
    source: uml`
      @startuml
      Alice -> Bob : <img:images/logo.png{scale=0.5}>
      @enduml
    `,
    expect: [
      ['<img:', 'entity.name.tag.creole'],
      ['images/logo.png', 'string.unquoted.path'],
      ['{scale=0.5}', 'constant.numeric.scale'],
    ],
  },
  {
    name: 'creole escapes and line markup in multi-line texts',
    covers: [],
    source: uml`
      @startuml
      Alice -> Bob : first\nsecond ~**not bold**
      note right of Alice
        = Heading
        * bullet
        ** nested
        # numbered
        |= Head | Cell |
        |_ tree item
        ----
        ==Section==
        <code>
        raw **code**
        </code>
      end note
      @enduml
    `,
    expect: [
      ['\\n', 'constant.character.escape'],
      ['~*', 'constant.character.escape'],
      ['=', 'punctuation.definition.heading'],
      ['Heading', 'markup.heading'],
      ['*', 'punctuation.definition.list.begin'],
      ['**', 'punctuation.definition.list.begin'],
      ['#', 'punctuation.definition.list.begin'],
      ['|=', 'punctuation.separator.table'],
      ['|_', 'punctuation.definition.list.begin'],
      ['----', 'punctuation.separator'],
      ['Section', 'markup.heading'],
      ['raw **code**', 'markup.raw.block !markup.bold'],
    ],
  },
];
