import { uml, type GrammarCase } from './types';

export const dataCases: GrammarCase[] = [
  {
    name: 'JSON: header commands, highlights, styles, comments and preprocessing around the data',
    covers: ['factory:JsonDiagramFactory'],
    source: uml`
      @startjson
      !$name = "plantuml-local"
      title Settings
      skinparam backgroundColor #EEE
      <style>
      jsonDiagram { node { BackGroundColor lightyellow } }
      </style>
      #highlight "tags" / "0"
      {
        "name": "$name",
        ' dropped by the preprocessor
        "tags": ["vscode", "markdown"],
      #highlight "offline"
        "offline": true,
      # a line starting with # is dropped
        "size": 12.5,
        "owner": null
      }
      @endjson
    `,
    expect: [
      ['!', 'keyword.control.directive'],
      ['title', 'keyword.other'],
      ['skinparam', 'keyword.other'],
      ['<style>', 'entity.name.tag.style'],
      ['#highlight', 'keyword.other'],
      ['"tags"', 'string.quoted.double'],
      ['/', 'keyword.operator.path'],
      ['{', 'meta.embedded.block.json'],
      ['"name"', 'meta.embedded.block.json support.type.property-name.json'],
      ['$name', 'variable.other'],
      ["' dropped by the preprocessor", 'comment.line.single-quote'],
      ['"vscode"', 'string.quoted.double.json'],
      ['#highlight', 'keyword.other'],
      ['true', 'constant.language.json'],
      ['# a line starting with # is dropped', 'comment.line.number-sign'],
      ['12.5', 'constant.numeric.json'],
      ['null', 'constant.language.json'],
      ['@endjson', 'keyword.control.diagram !meta.embedded.block.json'],
    ],
  },
  {
    name: 'YAML: header commands, highlights and preprocessing around the data',
    covers: ['factory:YamlDiagramFactory'],
    source: uml`
      @startyaml
      title Build
      #highlight "steps" / "1"
      name: plantuml-local
      # a YAML comment
      steps:
        - lint
        - test
      !$retries = 3
      retries: $retries
      @endyaml
    `,
    expect: [
      ['title', 'keyword.other'],
      ['#highlight', 'keyword.other'],
      ['name', 'meta.embedded.block.yaml entity.name.tag.yaml'],
      ['# a YAML comment', 'comment'],
      ['-', 'meta.embedded.block.yaml'],
      ['!', 'keyword.control.directive'],
      ['$retries', 'variable.other'],
      ['=', 'keyword.operator.assignment'],
      ['$retries', 'variable.other'],
      ['@endyaml', 'keyword.control.diagram !meta.embedded.block.yaml'],
    ],
  },
];
