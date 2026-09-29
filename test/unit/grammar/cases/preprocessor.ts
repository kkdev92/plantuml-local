import { uml, type GrammarCase } from './types';

export const preprocessorCases: GrammarCase[] = [
  {
    name: 'line comments and block comments',
    covers: ['preprocessor:COMMENT_SIMPLE', 'preprocessor:COMMENT_LONG_START'],
    source: uml`
      @startuml
      ' a line comment
        ' indented, still a comment
      /' one-line block comment '/
      /'
        multi-line
        block comment '/
      Alice -> Bob : don't stop /' trailing comment '/
      Bob -> Alice : ok /'''tag'''/ fine
      @enduml
    `,
    expect: [
      ["' a line comment", 'comment.line.single-quote'],
      ["' indented, still a comment", 'comment.line.single-quote'],
      ["/' one-line block comment '/", 'comment.block'],
      ['/\'\n  multi-line\n  block comment \'/', 'comment.block'],
      ["don't stop", '!comment'],
      ["/' trailing comment '/", 'comment.block'],
      ["/'''tag'''/", 'comment.block'],
      ['fine', '!comment'],
    ],
  },
  {
    name: 'a block comment opening a line leaves the rest of the line to the diagram',
    covers: [],
    source: uml`
      @startuml
      /' first '/ Alice -> Bob : hello
      @enduml
    `,
    expect: [
      ["/' first '/", 'comment.block'],
      ['Alice', '!comment'],
    ],
  },
  {
    name: 'variables: assignment, local and global scope, conditional assignment',
    covers: ['preprocessor:AFFECTATION'],
    source: uml`
      @startuml
      !$owner = "Platform team"
      !global $count ?= 2
      !answer = 42
      !procedure $shout($text)
        !local $loud = %upper($text)
        Alice -> Bob : $loud
      !endprocedure
      $shout("hi")
      Alice -> Bob : $owner
      @enduml
    `,
    expect: [
      ['!', 'keyword.control.directive'],
      ['$owner', 'variable.other'],
      ['=', 'keyword.operator.assignment'],
      ['"Platform team"', 'string.quoted.double'],
      ['!global', 'keyword.control.directive'],
      ['$count', 'variable.other'],
      ['?=', 'keyword.operator.assignment'],
      ['2', 'constant.numeric'],
      ['answer', 'variable.other'],
      ['42', 'constant.numeric'],
      ['!local', 'keyword.control.directive'],
      ['$loud', 'variable.other'],
      ['%upper', 'support.function.builtin'],
      ['$text', 'variable.other'],
      ['$shout', 'entity.name.function'],
      ['$owner', 'variable.other'],
    ],
  },
  {
    name: 'legacy macros: !define with and without arguments, !definelong',
    covers: ['preprocessor:AFFECTATION_DEFINE', 'preprocessor:LEGACY_DEFINE', 'preprocessor:LEGACY_DEFINELONG', 'preprocessor:END_FUNCTION'],
    source: uml`
      @startuml
      !define SERVER_NAME "api"
      !define LINK(a, b) a --> b
      !definelong BOX(name)
      rectangle name
      !enddefinelong
      BOX(Frontend)
      LINK(Frontend, SERVER_NAME)
      @enduml
    `,
    expect: [
      ['!define', 'keyword.control.directive'],
      ['SERVER_NAME', 'variable.other.constant'],
      ['!define', 'keyword.control.directive'],
      ['LINK', 'entity.name.function.macro'],
      ['a', 'variable.parameter'],
      ['b', 'variable.parameter'],
      ['!definelong', 'keyword.control.directive'],
      ['BOX', 'entity.name.function.macro'],
      ['!enddefinelong', 'keyword.control.directive'],
    ],
  },
  {
    name: 'conditions: !if, !elseif, !else, !endif, !ifdef, !ifndef, !undef',
    covers: [
      'preprocessor:IF',
      'preprocessor:ELSEIF',
      'preprocessor:ELSE',
      'preprocessor:ENDIF',
      'preprocessor:IFDEF',
      'preprocessor:IFNDEF',
      'preprocessor:UNDEF',
    ],
    source: uml`
      @startuml
      !$level = 2
      !if ($level > 1) && ($level != 5)
      Alice -> Bob : high
      !elseif $level == 1
      Alice -> Bob : low
      !else
      Alice -> Bob : none
      !endif
      !define FEATURE
      !ifdef FEATURE
      Bob -> Alice : on
      !endif
      !undef FEATURE
      !ifndef FEATURE
      Bob -> Alice : off
      !endif
      @enduml
    `,
    expect: [
      ['!if', 'keyword.control.directive'],
      ['$level', 'variable.other'],
      ['>', 'keyword.operator.comparison'],
      ['&&', 'keyword.operator.logical'],
      ['!=', 'keyword.operator.comparison'],
      ['5', 'constant.numeric'],
      ['!elseif', 'keyword.control.directive'],
      ['==', 'keyword.operator.comparison'],
      ['!else', 'keyword.control.directive'],
      ['!endif', 'keyword.control.directive'],
      ['!ifdef', 'keyword.control.directive'],
      ['!endif', 'keyword.control.directive'],
      ['!undef', 'keyword.control.directive'],
      ['!ifndef', 'keyword.control.directive'],
    ],
  },
  {
    name: 'directives are lower case (the engine rejects !IF)',
    covers: [],
    source: uml`
      @startuml
      !IF 1 == 1
      Alice -> Bob
      !ENDIF
      @enduml
    `,
    expect: [
      ['!IF', '!keyword.control.directive'],
      ['!ENDIF', '!keyword.control.directive'],
    ],
    render: /./,
  },
  {
    name: 'loops: !while and !foreach',
    covers: ['preprocessor:WHILE', 'preprocessor:ENDWHILE', 'preprocessor:FOREACH', 'preprocessor:ENDFOREACH'],
    source: uml`
      @startuml
      !$i = 0
      !while $i < 2
      participant "P$i"
      !$i = $i + 1
      !endwhile
      !foreach $name in ["Alice", "Bob"]
      participant $name
      !endfor
      @enduml
    `,
    expect: [
      ['!while', 'keyword.control.directive'],
      ['<', 'keyword.operator.comparison'],
      ['+', 'keyword.operator.arithmetic'],
      ['!endwhile', 'keyword.control.directive'],
      ['!foreach', 'keyword.control.directive'],
      ['$name', 'variable.other'],
      ['in', 'keyword.operator.word'],
      ['"Alice"', 'string.quoted.double'],
      ['!endfor', 'keyword.control.directive'],
    ],
  },
  {
    name: 'functions and procedures, unquoted and final, one-line return',
    covers: ['preprocessor:DECLARE_RETURN_FUNCTION', 'preprocessor:DECLARE_PROCEDURE', 'preprocessor:RETURN', 'preprocessor:END_FUNCTION'],
    source: uml`
      @startuml
      !function $double($x, $label = "twice")
        !return $x * 2
      !endfunction
      !final function $one() !return 1
      !unquoted procedure $greet($who)
        Alice -> $who : hello
      !end procedure
      $greet(Bob)
      Alice -> Bob : $double(21) $one()
      @enduml
    `,
    expect: [
      ['!function', 'keyword.control.directive'],
      ['$double', 'entity.name.function'],
      ['$x', 'variable.other'],
      ['"twice"', 'string.quoted.double'],
      ['!return', 'keyword.control.directive'],
      ['*', 'keyword.operator.arithmetic'],
      ['!endfunction', 'keyword.control.directive'],
      ['!final function', 'keyword.control.directive'],
      ['$one', 'entity.name.function'],
      ['!return', 'keyword.control.directive'],
      ['1', 'constant.numeric'],
      ['!unquoted procedure', 'keyword.control.directive'],
      ['$greet', 'entity.name.function'],
      ['!end procedure', 'keyword.control.directive'],
      ['$greet', 'entity.name.function'],
      ['$double', 'entity.name.function'],
    ],
  },
  {
    name: 'assertions, logging, memory dump and options',
    covers: ['preprocessor:ASSERT', 'preprocessor:LOG', 'preprocessor:DUMP_MEMORY', 'preprocessor:OPTION'],
    source: uml`
      @startuml
      !$n = 3
      !assert $n == 3 : "n must be three"
      !log n is $n
      !dump_memory
      !option handwritten true
      Alice -> Bob
      @enduml
    `,
    expect: [
      ['!assert', 'keyword.control.directive'],
      ['==', 'keyword.operator.comparison'],
      ['"n must be three"', 'string.quoted.double'],
      ['!log', 'keyword.control.directive'],
      ['$n', 'variable.other'],
      ['!dump_memory', 'keyword.control.directive'],
      ['!option', 'keyword.control.directive'],
      ['handwritten', 'variable.other.option'],
    ],
  },
  {
    name: 'themes and the bundled standard library',
    covers: ['preprocessor:THEME', 'preprocessor:INCLUDE'],
    source: uml`
      @startuml
      !theme plain
      !include <azure/AzureCommon>
      Alice -> Bob
      @enduml
    `,
    expect: [
      ['!theme', 'keyword.control.directive'],
      ['plain', 'string.unquoted.path'],
      ['!include', 'keyword.control.directive'],
      ['<azure/AzureCommon>', 'string.unquoted.path'],
    ],
  },
  {
    name: 'include variants that need files (unavailable in the browser engine)',
    covers: ['preprocessor:INCLUDE', 'preprocessor:INCLUDE_DEF', 'preprocessor:IMPORT', 'preprocessor:INCLUDESUB'],
    source: uml`
      @startuml
      !include_many common.puml
      !include_once common.puml
      !includedef defs.puml
      !import library.zip
      !includesub parts.puml!BASIC
      Alice -> Bob
      @enduml
    `,
    expect: [
      ['!include_many', 'keyword.control.directive'],
      ['common.puml', 'string.unquoted.path'],
      ['!include_once', 'keyword.control.directive'],
      ['!includedef', 'keyword.control.directive'],
      ['!import', 'keyword.control.directive'],
      ['library.zip', 'string.unquoted.path'],
      ['!includesub', 'keyword.control.directive'],
      ['parts.puml!BASIC', 'string.unquoted.path'],
    ],
    render: /./,
  },
  {
    name: 'sub-parts for !includesub',
    covers: ['preprocessor:STARTSUB', 'preprocessor:ENDSUB'],
    source: uml`
      @startuml
      !startsub BASIC
      Alice -> Bob
      !endsub
      @enduml
    `,
    expect: [
      ['!startsub', 'keyword.control.directive'],
      ['BASIC', 'string.unquoted.path'],
      ['!endsub', 'keyword.control.directive'],
    ],
  },
  {
    name: 'a JSON value over several lines, and an embedded diagram in a procedure body',
    covers: [],
    source: uml`
      @startuml
      !$data = {
        "name": "plantuml-local",
        "tags": ["vscode", "markdown"]
      }
      !$list = [
        "one",
        "two"
      ]
      !procedure $inner()
      {{
      A -> B : inner
      }}
      !endprocedure
      Alice -> Bob : hi
      note right
      $inner()
      end note
      @enduml
    `,
    expect: [
      ['$data', 'variable.other'],
      ['=', 'keyword.operator.assignment'],
      ['"name"', 'support.type.property-name.json'],
      ['"vscode"', 'string.quoted.double.json'],
      ['$list', 'variable.other'],
      ['"one"', 'string.quoted.double.json'],
      ['{{', 'punctuation.section.embedded.begin'],
      ['A -> B : inner', 'meta.embedded-diagram !keyword.operator.arrow'],
      ['}}', 'punctuation.section.embedded.end'],
      ['!endprocedure', 'keyword.control.directive'],
      ['->', 'keyword.operator.arrow !meta.embedded.block.json'],
    ],
  },
];
