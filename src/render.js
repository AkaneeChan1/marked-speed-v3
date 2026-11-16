// The HTML renderer: a port of marked 18.1.3's Renderer and TextRenderer (MIT; see
// vendor/marked/LICENSE). It produces marked's exact bytes for the same token stream.
//
// Output is built by appending into a local string and returning it, which keeps V8 on the
// rope representation instead of flattening at every nesting level.

import { other } from './rules.js';
import { encodeUrl, escape } from './util.js';

export class Renderer {
  constructor() {
    this.parser = null;
  }

  space() {
    return '';
  }

  code({ text, lang }) {
    const info = (lang || '').match(other.notSpaceStart);
    const langName = info ? info[0] : '';
    const body = text ? text.replace(other.endingNewline, '') + '\n' : '';
    if (langName) return '<pre><code class="language-' + escape(langName) + '">' + escape(body, true) + '</code></pre>\n';
    return '<pre><code>' + escape(body, true) + '</code></pre>\n';
  }

  blockquote({ tokens }) {
    return '<blockquote>\n' + this.parser.parse(tokens) + '</blockquote>\n';
  }

  html({ text }) {
    return text;
  }

  def() {
    return '';
  }

  heading({ tokens, depth }) {
    return '<h' + depth + '>' + this.parser.parseInline(tokens) + '</h' + depth + '>\n';
  }

  hr() {
    return '<hr>\n';
  }

  list(token) {
    let body = '';
    for (let i = 0; i < token.items.length; i++) body += this.listitem(token.items[i]);
    const tag = token.ordered ? 'ol' : 'ul';
    const startAttr = token.ordered && token.start !== 1 ? ' start="' + token.start + '"' : '';
    return '<' + tag + startAttr + '>\n' + body + '</' + tag + '>\n';
  }

  listitem(item) {
    return '<li>' + this.parser.parse(item.tokens) + '</li>\n';
  }

  checkbox({ checked }) {
    return '<input ' + (checked ? 'checked="" ' : '') + 'disabled="" type="checkbox"> ';
  }

  paragraph({ tokens }) {
    return '<p>' + this.parser.parseInline(tokens) + '</p>\n';
  }

  table(token) {
    let cells = '';
    for (let i = 0; i < token.header.length; i++) cells += this.tablecell(token.header[i]);
    const header = this.tablerow({ text: cells });
    let body = '';
    for (let r = 0; r < token.rows.length; r++) {
      const row = token.rows[r];
      cells = '';
      for (let c = 0; c < row.length; c++) cells += this.tablecell(row[c]);
      body += this.tablerow({ text: cells });
    }
    if (body) body = '<tbody>' + body + '</tbody>';
    return '<table>\n<thead>\n' + header + '</thead>\n' + body + '</table>\n';
  }

  tablerow({ text }) {
    return '<tr>\n' + text + '</tr>\n';
  }

  tablecell(cell) {
    const content = this.parser.parseInline(cell.tokens);
    const tag = cell.header ? 'th' : 'td';
    return (cell.align ? '<' + tag + ' align="' + cell.align + '">' : '<' + tag + '>') + content + '</' + tag + '>\n';
  }

  strong({ tokens }) {
    return '<strong>' + this.parser.parseInline(tokens) + '</strong>';
  }

  em({ tokens }) {
    return '<em>' + this.parser.parseInline(tokens) + '</em>';
  }

  codespan({ text }) {
    return '<code>' + escape(text, true) + '</code>';
  }

  br() {
    return '<br>';
  }

  del({ tokens }) {
    return '<del>' + this.parser.parseInline(tokens) + '</del>';
  }

  link({ href, title, text, tokens, autolink }) {
    const content = autolink ? escape(text, true) : this.parser.parseInline(tokens);
    const url = encodeUrl(href);
    if (url === null) return content;
    let out = '<a href="' + escape(url, autolink) + '"';
    if (title) out += ' title="' + escape(title) + '"';
    out += '>' + content + '</a>';
    return out;
  }

  image({ href, title, text, tokens }) {
    if (tokens) text = this.parser.parseInline(tokens, this.parser.textRenderer);
    const url = encodeUrl(href);
    if (url === null) return escape(text);
    let out = '<img src="' + escape(url) + '" alt="' + escape(text) + '"';
    if (title) out += ' title="' + escape(title) + '"';
    out += '>';
    return out;
  }

  text(token) {
    if (token.tokens) return this.parser.parseInline(token.tokens);
    if (token.escaped) return token.text;
    return escape(token.text);
  }
}

export class TextRenderer {
  constructor() {
    this.parser = null;
  }

  strong({ text, tokens }) {
    return tokens ? this.parser.parseInline(tokens, this) : text;
  }

  em({ text, tokens }) {
    return tokens ? this.parser.parseInline(tokens, this) : text;
  }

  codespan({ text }) {
    return text;
  }

  del({ text, tokens }) {
    return tokens ? this.parser.parseInline(tokens, this) : text;
  }

  html({ text }) {
    return text;
  }

  text({ text }) {
    return text;
  }

  link({ text, tokens }) {
    return tokens ? this.parser.parseInline(tokens, this) : text;
  }

  image({ text, tokens }) {
    return tokens ? this.parser.parseInline(tokens, this) : text;
  }

  br() {
    return '';
  }

  checkbox({ raw }) {
    return raw;
  }
}
