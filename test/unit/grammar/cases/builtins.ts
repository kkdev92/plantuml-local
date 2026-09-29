import { uml, type GrammarCase } from './types';

export const builtinCases: GrammarCase[] = [
  {
    name: 'every builtin function of the preprocessor, called the way the engine accepts it',
    covers: [],
    source: uml`
      @startuml
      !function $twice($a) !return $a * 2
      !procedure $hello()
      Alice -> Bob : hello
      !endprocedure
      !$j = %str2json('{"a": 1, "b": [1, 2]}')
      !$v01 = %false()
      !$v02 = %true()
      !$v03 = %backslash()
      !$v04 = %boolval("true")
      !$v05 = %breakline()
      !$v06 = %call_user_func("$twice", 2)
      !$v07 = %chr(65)
      !$v08 = %darken("red", 20)
      !$v09 = %date("yyyy")
      !$v10 = %dec2hex(255)
      !$v11 = %dirpath()
      !$v12 = %dollar()
      !$v13 = %eval("1 + 2")
      !$v14 = %feature("style")
      !$v15 = %filedate()
      !$v16 = %file_exists("missing.txt")
      !$v17 = %filename()
      !$v18 = %filename_no_extension()
      !$v19 = %function_exists("$twice")
      !$v20 = %get_all_theme()
      !$v21 = %get_current_theme()
      !$v22 = %get_json_keys($j)
      !$v23 = %get_json_type($j)
      !$v24 = %get_variable_value("$v01")
      !$v25 = %version()
      !$v26 = %getenv("HOME")
      !$v27 = %hex2dec("ff")
      !$v28 = %hsl_color(120, 50, 50)
      !$v29 = %intval("42")
      !$v30 = %is_dark("#000000")
      !$v31 = %is_light("#ffffff")
      !$v32 = %json_add($j, "c", 3)
      !$v33 = %json_key_exists($j, "a")
      !$v34 = %json_merge($j, $j)
      !$v35 = %json_remove($j, "a")
      !$v36 = %json_set($j, "a", 2)
      !$v37 = %lighten("red", 20)
      !$v38 = %load_json("missing.json", '{"default": true}')
      !$v39 = %and(1, 1)
      !$v40 = %nand(1, 1)
      !$v41 = %nor(0, 0)
      !$v42 = %not(0)
      !$v43 = %nxor(1, 1)
      !$v44 = %or(1, 0)
      !$v45 = %xor(1, 0)
      !$v46 = %lower("ABC")
      !$v47 = %mod(7, 3)
      !$v48 = %newline()
      !$v49 = %n()
      !$v50 = %now()
      !$v51 = %ord("A")
      !$v52 = %percent()
      !$v53 = %random(1, 10)
      !$v54 = %reverse_color("#000000")
      !$v55 = %reverse_hsluv_color("#000000")
      !$v56 = %set_variable_value("$v99", 1)
      !$v57 = %size("abc")
      !$v58 = %splitstr("a,b", ",")
      !$v59 = %splitstr_regex("a1b", "[0-9]")
      !$v60 = %string(12)
      !$v61 = %strlen("abc")
      !$v62 = %strpos("abc", "c")
      !$v63 = %substr("abcdef", 1, 3)
      !$v64 = %tab()
      !$v65 = %upper("abc")
      !$v66 = %variable_exists("$v01")
      !$v67 = %retrieve_procedure("$hello")
      !$v68 = %xargs("unused")
      %invoke_procedure("$hello")
      Alice -> Bob : %left_align()left %right_align()right $v07
      @enduml
    `,
    expect: [
      ['%str2json', 'support.function.builtin'],
      ['%false', 'support.function.builtin'],
      ['%call_user_func', 'support.function.builtin'],
      ['"$twice"', 'string.quoted.double'],
      ['%load_json', 'support.function.builtin'],
      ["'{\"default\": true}'", 'string.quoted.single'],
      ['%invoke_procedure', 'support.function.builtin'],
      ['%left_align', 'support.function.builtin'],
      ['%right_align', 'support.function.builtin'],
    ],
  },
];
