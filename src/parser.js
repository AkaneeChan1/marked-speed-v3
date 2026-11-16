// The token-tree renderer: a port of marked 18.1.3's Parser (MIT; see vendor/marked/LICENSE).
// Extensions are not part of the default options, so the extension hooks are left out.
//
// One representation detail: a plain inline text run is stored as a JavaScript string
// rather than a {type: 'text', text} object (see src/inline.js). Strings are escaped the
// same way a text token's text is, at the top of both loops.

import { Renderer, TextRenderer } from './render.js';
import { escape } from './util.js';

export class Parser {
  constructor() {
    this.renderer = new Renderer();
    this.renderer.parser = this;
    this.textRenderer = new TextRenderer();
    this.textRenderer.parser = this;
  }

  parse(tokens) {
    let out = '';
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (typeof token === 'string') {
        out += escape(token);
        continue;
      }
      switch (token.type) {
        case 'space':
          break;
        case 'hr':
          out += '<hr>\n';
          break;
        case 'heading':
          out += '<h' + token.depth + '>' + this.parseInline(token.tokens) + '</h' + token.depth + '>\n';
          break;
        case 'code':
          out += this.renderer.code(token);
          break;
        case 'table':
          out += this.renderer.table(token);
          break;
        case 'blockquote':
          out += '<blockquote>\n' + this.parse(token.tokens) + '</blockquote>\n';
          break;
        case 'list':
          out += this.renderer.list(token);
          break;
        case 'checkbox':
          out += this.renderer.checkbox(token);
          break;
        case 'html':
          out += token.text;
          break;
        case 'def':
          break;
        case 'paragraph':
          out += '<p>' + this.parseInline(token.tokens) + '</p>\n';
          break;
        case 'text':
          out += typeof token === 'string' ? escape(token) : token.tokens ? this.parseInline(token.tokens) : token.escaped ? token.text : escape(token.text);
          break;
        default:
          throw new Error('Token with "' + token.type + '" type was not found.');
      }
    }
    return out;
  }

  parseInline(tokens, renderer = this.renderer) {
    let out = '';
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (typeof token === 'string') {
        out += escape(token);
        continue;
      }
      switch (token.type) {
        case 'escape':
          out += renderer.text(token);
          break;
        case 'html':
          out += token.text;
          break;
        case 'link':
          out += renderer.link(token);
          break;
        case 'image':
          out += renderer.image(token);
          break;
        case 'checkbox':
          out += renderer.checkbox(token);
          break;
        case 'strong':
          out += renderer.strong(token);
          break;
        case 'em':
          out += renderer.em(token);
          break;
        case 'codespan':
          out += renderer.codespan(token);
          break;
        case 'br':
          out += renderer.br(token);
          break;
        case 'del':
          out += renderer.del(token);
          break;
        case 'text':
          out += typeof token === 'string' ? escape(token) : token.tokens ? this.parseInline(token.tokens, renderer) : token.escaped ? token.text : escape(token.text);
          break;
        default:
          throw new Error('Token with "' + token.type + '" type was not found.');
      }
    }
    return out;
  }
}
