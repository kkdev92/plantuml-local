import { uml, type GrammarCase } from './types';

export const networkCases: GrammarCase[] = [
  {
    name: 'nwdiag: networks, properties, elements, groups, links and comments',
    covers: [
      'command:CommandNwDiagInit',
      'command:CommandComment',
      'command:CommandElement',
      'command:CommandGroup',
      'command:CommandNetwork',
      'command:nwdiag.CommandLink',
      'command:CommandProperty',
      'command:CommandEndSomething',
    ],
    source: uml`
      @startnwdiag
      title Network
      nwdiag {
        // the public segment
        network dmz {
          address = "210.x.x.x/24"
          color = "#FFEEEE"
          web01 [address = "210.x.x.1", shape = database, description = "Web server"];
          web02;
        }
        network internal {
          address = "172.x.x.x/24";
          web01 [address = "172.x.x.1"];
          db01;
        }
        group {
          color = "#CCFFCC";
          web01;
          db01;
        }
        web01 -- db01;
      }
      @endnwdiag
    `,
    expect: [
      ['@startnwdiag', 'keyword.control.diagram'],
      ['title', 'keyword.other'],
      ['nwdiag', 'storage.type'],
      ['{', 'punctuation.section.block'],
      ['// the public segment', 'comment.line.double-slash'],
      ['network', 'storage.type'],
      ['dmz', 'entity.name.type'],
      ['address', 'support.type.property-name'],
      ['=', 'keyword.operator.assignment'],
      ['210.x.x.x/24', 'string.quoted.double'],
      ['color', 'support.type.property-name'],
      ['#FFEEEE', 'constant.other.color'],
      ['web01', 'entity.name.type'],
      ['address', 'support.type.property-name'],
      ['"210.x.x.1"', 'string.quoted.double'],
      ['shape', 'support.type.property-name'],
      ['database', 'support.constant.property-value'],
      [';', 'punctuation.terminator'],
      ['web02', 'entity.name.type'],
      ['}', 'punctuation.section.block'],
      ['group', 'storage.type'],
      ['web01', 'entity.name.type'],
      ['--', 'keyword.operator.arrow'],
      ['db01', 'entity.name.type'],
    ],
  },
  {
    name: 'packetdiag: settings, bit ranges with attributes',
    covers: [
      'command:CommandPacketDiagStart',
      'command:CommandColWidth',
      'command:CommandNodeHeight',
      'command:CommandScaleDirection',
      'command:CommandScaleInterval',
      'command:CommandSameHeight',
      'command:CommandNumRange',
      'command:CommandPacketDiagEnd',
    ],
    source: uml`
      @startpacketdiag
      title TCP header
      packetdiag {
        colwidth = 32
        node_height = 72
        scale_direction = ltr
        scale_interval = 8
        same_height = true
        0-15: Source Port
        16-31: Destination Port [color = pink]
        32: Flag
        * Reserved
      }
      @endpacketdiag
    `,
    expect: [
      ['@startpacketdiag', 'keyword.control.diagram'],
      ['title', 'keyword.other'],
      ['packetdiag', 'storage.type'],
      ['colwidth', 'support.type.property-name'],
      ['=', 'keyword.operator.assignment'],
      ['32', 'constant.numeric'],
      ['node_height', 'support.type.property-name'],
      ['scale_direction', 'support.type.property-name'],
      ['ltr', 'constant.language'],
      ['scale_interval', 'support.type.property-name'],
      ['same_height', 'support.type.property-name'],
      ['true', 'constant.language'],
      ['0', 'constant.numeric'],
      ['-', 'keyword.operator.range'],
      ['15', 'constant.numeric'],
      [':', 'punctuation.separator.label'],
      ['16', 'constant.numeric'],
      ['[', 'punctuation.section.brackets.begin'],
      ['color', 'support.type.property-name'],
      ['pink', 'support.constant.property-value'],
      ['32', 'constant.numeric'],
      ['*', 'keyword.operator'],
      ['}', 'punctuation.section.block'],
    ],
  },
];
