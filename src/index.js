// parse(markdown): the HTML marked 18.1.3 renders for it with its default options
// (gfm on, breaks off, pedantic off, async off).
//
// One Lexer and one Parser are created when this module loads and reset per call, so a
// document pays for its own tokens and nothing else.

import { Lexer } from './lexer.js';
import { Parser } from './parser.js';

const lexer = new Lexer();
const parser = new Parser();

export function parse(markdown) {
  lexer.reset();
  return parser.parse(lexer.lex(markdown));
}
