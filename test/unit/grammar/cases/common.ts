import { uml, type GrammarCase } from './types';

export const commonCases: GrammarCase[] = [
  {
    name: 'one-line title, caption, legend, header, footer and mainframe',
    covers: [
      'command:CommandTitle',
      'command:CommandCaption',
      'command:CommandLegend',
      'command:CommandHeader',
      'command:CommandFooter',
      'command:CommandMainframe',
    ],
    source: uml`
      @startuml
      title Order **flow**
      caption: Figure 1
      legend "Legend text"
      left header Confidential
      right footer Page 1
      mainframe sd Checkout
      Alice -> Bob
      @enduml
    `,
    expect: [
      ['title', 'keyword.other'],
      ['flow', 'markup.bold'],
      ['caption', 'keyword.other'],
      [':', 'punctuation.separator.label'],
      ['legend', 'keyword.other'],
      ['"Legend text"', 'string.quoted.double'],
      ['left', 'keyword.other'],
      ['header', 'keyword.other'],
      ['right', 'keyword.other'],
      ['footer', 'keyword.other'],
      ['mainframe', 'keyword.other'],
    ],
  },
  {
    name: 'multi-line title, caption, legend, header and footer',
    covers: [
      'command:CommandMultilinesTitle',
      'command:CommandMultilinesCaption',
      'command:CommandMultilinesLegend',
      'command:CommandMultilinesHeader',
      'command:CommandMultilinesFooter',
    ],
    source: uml`
      @startuml
      title
        Checkout
        //second line//
      end title
      caption
        Figure 2
      endcaption
      legend top left
        | Key | Meaning |
        | A | Alice |
      endlegend
      center header
        Draft
      endheader
      footer
        Generated
      end footer
      Alice -> Bob
      @enduml
    `,
    expect: [
      ['title', 'keyword.other'],
      ['second line', 'markup.italic'],
      ['end title', 'keyword.other'],
      ['caption', 'keyword.other'],
      ['endcaption', 'keyword.other'],
      ['legend', 'keyword.other'],
      ['top', 'keyword.other'],
      ['left', 'keyword.other'],
      ['|', 'punctuation.separator.table'],
      ['endlegend', 'keyword.other'],
      ['center', 'keyword.other'],
      ['header', 'keyword.other'],
      ['endheader', 'keyword.other'],
      ['footer', 'keyword.other'],
      ['end footer', 'keyword.other'],
      ['Alice', '!keyword.other'],
    ],
  },
  {
    name: 'skinparam: one line, several on one line, locked, blocks with nesting',
    covers: ['command:CommandSkinParam', 'command:CommandSkinParamJaws', 'command:CommandSkinParamMultilines'],
    source: uml`
      @startuml
      skinparam ArrowColor #336699
      skinparam ArrowThickness 2\nskinparam SequenceLifeLineBorderColor blue
      skinparamlocked monochrome false
      skinparam participant {
        BackgroundColor<<Warning>> Orange
        FontName "Courier"
      }
      skinparam {
        sequence {
          ArrowColor red
        }
      }
      participant Alice <<Warning>>
      Alice -> Bob
      @enduml
    `,
    expect: [
      ['skinparam', 'keyword.other'],
      ['ArrowColor', 'support.type.property-name'],
      ['#336699', 'constant.other.color'],
      ['skinparam', 'keyword.other'],
      ['2', 'constant.numeric'],
      ['\\n', 'constant.character.escape'],
      ['skinparam', 'keyword.other'],
      ['SequenceLifeLineBorderColor', 'support.type.property-name'],
      ['skinparamlocked', 'keyword.other'],
      ['false', 'constant.language'],
      ['skinparam', 'keyword.other'],
      ['participant', 'support.type.property-name'],
      ['{', 'punctuation.section.block.begin'],
      ['BackgroundColor', 'support.type.property-name'],
      ['<<Warning>>', 'entity.name.tag.stereotype'],
      ['"Courier"', 'string.quoted.double'],
      ['}', 'punctuation.section.block.end'],
      ['sequence', 'support.type.property-name'],
      ['ArrowColor', 'support.type.property-name'],
    ],
  },
  {
    name: 'styles: <style> blocks, one-line styles, style imports',
    covers: ['command:CommandStyleMultilinesCSS', 'command:CommandStyleSingleLineCSS'],
    source: uml`
      @startuml
      <style>
      // comment inside a style
      sequenceDiagram {
        participant {
          BackGroundColor #EEF
          LineThickness 2
        }
        .warning {
          FontColor: red;
        }
      }
      </style>
      <style>arrow { LineColor blue }</style>
      Alice -> Bob
      @enduml
    `,
    expect: [
      ['<style>', 'entity.name.tag.style'],
      ['// comment inside a style', 'comment.line.double-slash'],
      ['sequenceDiagram', 'entity.name.tag.selector'],
      ['participant', 'entity.name.tag.selector'],
      ['BackGroundColor', 'support.type.property-name'],
      ['#EEF', 'constant.other.color'],
      ['LineThickness', 'support.type.property-name'],
      ['2', 'constant.numeric'],
      ['.warning', 'entity.other.attribute-name.class'],
      ['FontColor', 'support.type.property-name'],
      ['red', 'support.constant.property-value'],
      ['</style>', 'entity.name.tag.style'],
      ['<', 'punctuation.definition.tag.begin'],
      ['arrow', 'entity.name.tag.selector'],
      ['LineColor', 'support.type.property-name'],
    ],
  },
  {
    name: 'style import (needs a file: unavailable in the browser engine)',
    covers: ['command:CommandStyleImport'],
    source: uml`
      @startuml
      <style file=custom.css>
      Alice -> Bob
      @enduml
    `,
    expect: [
      ['style', 'entity.name.tag.style'],
      ['file', 'entity.other.attribute-name'],
      ['custom.css', 'string.unquoted.path'],
    ],
    render: /./,
  },
  {
    name: 'sprites: hex rows, compressed one-line data, SVG on one and on several lines',
    covers: [
      'command:CommandFactorySprite.createMultiLine(false)',
      'command:CommandFactorySprite.createSingleLine',
      'command:CommandSpriteSvg',
      'command:CommandSpriteSvgMultiline',
    ],
    source: uml`
      @startuml
      sprite $box [8x8/16] {
      FFFFFFFF
      F000000F
      FFFFFFFF
      }
      sprite $small [8x8/16z] usS00tu6VWW5nlmGCNu6P9eVBWrN3cG00000
      sprite $dot <svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>
      sprite $bar <svg viewBox="0 0 10 10">
      <rect width="10" height="4"/>
      </svg>
      Alice -> Bob : <$box> <$dot> <$bar>
      @enduml
    `,
    expect: [
      ['sprite', 'keyword.other'],
      ['$box', 'entity.name.type.sprite'],
      ['[8x8/16]', 'constant.numeric.dimension'],
      ['FFFFFFFF', 'constant.other.sprite-data'],
      ['sprite', 'keyword.other'],
      ['$small', 'entity.name.type.sprite'],
      ['[8x8/16z]', 'constant.numeric.dimension'],
      ['usS00tu6VWW5nlmGCNu6P9eVBWrN3cG00000', 'constant.other.sprite-data'],
      ['$dot', 'entity.name.type.sprite'],
      ['<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>', 'meta.embedded.svg'],
      ['$bar', 'entity.name.type.sprite'],
      ['<rect width="10" height="4"/>', 'meta.embedded.svg'],
      ['<$box>', 'constant.other.symbol.sprite'],
    ],
  },
  {
    name: 'sprites from PNG data, from a digest and from a file',
    covers: ['command:CommandSpriteBase64', 'command:CommandSpriteMd5', 'command:CommandSpriteFile'],
    source: uml`
      @startuml
      sprite $png data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==
      sprite $known data:image/png;md5,0123456789abcdef0123456789abcdef
      sprite $file images/icon.png
      Alice -> Bob : <$png>
      @enduml
    `,
    expect: [
      ['$png', 'entity.name.type.sprite'],
      ['data:image/png;base64,', 'keyword.other.data-uri'],
      ['iVBORw0KGgo', 'constant.other.sprite-data'],
      ['data:image/png;md5,', 'keyword.other.data-uri'],
      ['$file', 'entity.name.type.sprite'],
      ['images/icon.png', 'string.unquoted.path'],
    ],
    render: /./,
  },
  {
    name: 'scale in all its forms',
    covers: [
      'command:CommandScale',
      'command:CommandScaleWidthAndHeight',
      'command:CommandScaleWidthOrHeight',
      'command:CommandScaleMaxWidth',
      'command:CommandScaleMaxHeight',
      'command:CommandScaleMaxWidthAndHeight',
    ],
    source: uml`
      @startuml
      scale 1.5
      scale 2/3
      scale 400*300
      scale 400 width
      scale max 800 width
      scale max 600 height
      scale max 800x600
      Alice -> Bob
      @enduml
    `,
    expect: [
      ['scale', 'keyword.other'],
      ['1.5', 'constant.numeric'],
      ['scale', 'keyword.other'],
      ['/', 'keyword.operator'],
      ['3', 'constant.numeric'],
      ['*', 'keyword.operator'],
      ['width', 'keyword.other'],
      ['max', 'keyword.other'],
      ['height', 'keyword.other'],
      ['max', 'keyword.other'],
      ['x', 'keyword.operator'],
    ],
  },
  {
    name: 'hide and show: empty descriptions, members by visibility or kind, circles, footbox',
    covers: [
      'command:CommandHideEmptyDescription',
      'command:CommandHideShowByVisibility',
      'command:CommandHideShowByGender',
      'command:CommandFootboxIgnored',
    ],
    source: uml`
      @startuml
      hide empty description
      hide private, protected members
      show public methods
      hide interface circle
      hide <<Entity>> stereotype
      hide empty members
      hide footbox
      class Order
      interface Store
      @enduml
    `,
    expect: [
      ['hide', 'keyword.other'],
      ['empty', 'keyword.other'],
      ['description', 'keyword.other'],
      ['hide', 'keyword.other'],
      ['private, protected', 'storage.modifier'],
      ['members', 'keyword.other'],
      ['show', 'keyword.other'],
      ['public', 'storage.modifier'],
      ['methods', 'keyword.other'],
      ['interface', 'storage.type'],
      ['circle', 'keyword.other'],
      ['<<Entity>>', 'entity.name.tag.stereotype'],
      ['stereotype', 'keyword.other'],
      ['empty', 'keyword.other'],
      ['hide', 'keyword.other'],
      ['footbox', 'keyword.other'],
    ],
  },
  {
    name: 'pragmas, transparency, skins, page size, rotation, separators, blank lines',
    covers: [
      'command:CommandPragma',
      'command:CommandAssumeTransparent',
      'command:CommandSkin',
      'command:CommandMinwidth',
      'command:CommandPage',
      'command:CommandRotate',
      'command:CommandNamespaceSeparator',
      'command:CommandNope',
    ],
    source: uml`
      @startuml
      !pragma teoz true
      !assume transparent dark
      skin rose
      minwidth 50
      page 2x1
      rotate
      set namespaceSeparator ::

      Alice -> Bob
      @enduml
    `,
    expect: [
      ['!pragma', 'keyword.control.directive'],
      ['teoz', 'variable.other.option'],
      ['true', 'constant.language'],
      ['!assume', 'keyword.control.directive'],
      ['transparent', 'keyword.other'],
      ['dark', 'keyword.other'],
      ['skin', 'keyword.other'],
      ['rose', 'support.constant.skin'],
      ['minwidth', 'keyword.other'],
      ['50', 'constant.numeric'],
      ['page', 'keyword.other'],
      ['2', 'constant.numeric'],
      ['rotate', 'keyword.other'],
      ['set', 'keyword.other'],
      ['namespaceSeparator', 'keyword.other'],
      ['::', 'constant.character.separator'],
    ],
  },
];
