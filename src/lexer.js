// The lexer: a port of marked 18.1.3's Lexer (MIT; see vendor/marked/LICENSE), specialised
// to the default options. One instance is reused for every document; reset() clears it.
//
// blockTokens dispatches on the first code unit after up to three spaces of indent instead
// of running all thirteen block rules at every position, and the inline entry point only
// builds the emphasis mask when the text contains a delimiter character. The rules are
// tried in marked's order; the dispatch only skips the ones that cannot match.

import { BlockScanner } from './block.js';
import { InlineScanner } from './inline.js';
import { inline, other } from './rules.js';
import { normalizeLabel } from './util.js';

const TAB = 9;
const SPACE = 32;
const NEWLINE = 10;
const HASH = 35;
const STAR = 42;
const PLUS = 43;
const DASH = 45;
const LT = 60;
const GT = 62;
const LBRACKET = 91;
const BACKTICK = 96;
const UNDER = 95;
const TILDE = 126;
const PIPE = 124;
const EQ = 61;

/**
 * Could `src` contain a setext heading underline? The lheading rule needs a line that is
 * nothing but `=` or `-` after at most three spaces, somewhere inside the paragraph. This
 * is a cheap necessary-condition scan; the rule itself still decides.
 */
function hasSetextUnderline(src) {
  const n = src.length;
  let nl = src.indexOf('\n');
  if (nl === -1) return false;
  while (nl !== -1 && nl + 1 < n) {
    const j = nl + 1;
    let k = j;
    let c = src.charCodeAt(k);
    while (c === SPACE || c === TAB) {
      k++;
      c = src.charCodeAt(k);
    }
    if (k >= n) return false;
    if (c === NEWLINE) return false; // a blank line ends the paragraph
    if (k - j <= 3 && (c === EQ || c === DASH)) {
      let m = k + 1;
      while (m < n && src.charCodeAt(m) === c) m++;
      while (m < n && (src.charCodeAt(m) === SPACE || src.charCodeAt(m) === TAB)) m++;
      if (m >= n || src.charCodeAt(m) === NEWLINE) return true;
    }
    nl = src.indexOf('\n', j);
  }
  return false;
}

export class Lexer {
  constructor() {
    this.tokens = [];
    this.tokens.links = Object.create(null);
    this.haveLinks = false;
    this.inlineQueue = [];
    this.state = { inLink: false, inRawBlock: false, linkEmitted: false, linkParenPossible: true, top: true };
    this.block = new BlockScanner(this);
    this.inlineScanner = new InlineScanner(this);
  }

  reset() {
    this.tokens = [];
    this.tokens.links = Object.create(null);
    this.haveLinks = false;
    this.inlineQueue = [];
    this.state.inLink = false;
    this.state.inRawBlock = false;
    this.state.linkEmitted = false;
    this.state.linkParenPossible = true;
    this.state.top = true;
    this.inlineScanner.maskStack.length = 0;
  }

  lex(src) {
    if (src.indexOf('\r') !== -1) src = src.replace(other.carriageReturn, '\n');
    this.blockTokens(src, this.tokens);
    const queue = this.inlineQueue;
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      this.state.inRawBlock = false;
      this.inlineTokens(item.src, item.tokens);
    }
    this.inlineQueue = [];
    return this.tokens;
  }

  blockTokens(src, tokens = [], inBlockquote = false) {
    let shortest = Infinity;
    while (src.length > 0) {
      if (src.length < shortest) shortest = src.length;
      else {
        this.infiniteLoopError(src.charCodeAt(0));
        break;
      }

      let token;
      const c0 = src.charCodeAt(0);
      if (c0 === NEWLINE || c0 === SPACE || c0 === TAB) {
        token = this.block.space(src);
        if (token !== undefined) {
          src = src.substring(token.raw.length);
          const last = tokens[tokens.length - 1];
          if (token.raw.length === 1 && last !== undefined) last.raw += '\n';
          else tokens.push(token);
          continue;
        }
      }

      // Every block rule accepts a 0..3 space indent, so look past it for the dispatch
      // character. Four or more spaces means indented code.
      let pad = 0;
      while (pad < 4 && src.charCodeAt(pad) === SPACE) pad++;
      const wide = pad >= 4;
      const fc = wide ? SPACE : src.charCodeAt(pad);

      if (wide || fc === TAB) {
        token = this.block.code(src);
        if (token !== undefined) {
          src = src.substring(token.raw.length);
          const last = tokens[tokens.length - 1];
          if (last !== undefined && (last.type === 'paragraph' || last.type === 'text')) {
            last.raw += (last.raw.endsWith('\n') ? '' : '\n') + token.raw;
            last.text += '\n' + token.text;
            this.inlineQueue[this.inlineQueue.length - 1].src = last.text;
          } else tokens.push(token);
          continue;
        }
      }

      token = undefined;
      if (!wide) {
        switch (fc) {
          case BACKTICK:
          case TILDE:
            token = this.block.fences(src);
            break;
          case HASH:
            token = this.block.heading(src);
            break;
          case GT:
            token = this.block.blockquote(src);
            break;
          case DASH:
          case STAR:
            token = this.block.hr(src) || this.block.list(src);
            break;
          case UNDER:
            token = this.block.hr(src);
            break;
          case PLUS:
            token = this.block.list(src);
            break;
          case LT:
            token = this.block.html(src);
            break;
          case LBRACKET:
            token = this.block.def(src);
            break;
          default:
            if (fc >= 48 && fc <= 57) token = this.block.list(src);
        }
      }

      if (token !== undefined) {
        src = src.substring(token.raw.length);
        if (token.type === 'def') {
          const last = tokens[tokens.length - 1];
          if (last !== undefined && (last.type === 'paragraph' || last.type === 'text')) {
            last.raw += (last.raw.endsWith('\n') ? '' : '\n') + token.raw;
            last.text += '\n' + token.raw;
            this.inlineQueue[this.inlineQueue.length - 1].src = last.text;
          } else {
            if (!this.tokens.links[token.tag]) {
              this.tokens.links[token.tag] = { href: token.href, title: token.title };
              this.haveLinks = true;
            }
            tokens.push(token);
          }
        } else {
          tokens.push(token);
        }
        continue;
      }

      // A gfm table needs a pipe on its second line.
      let tryTable = false;
      const nl = wide ? -1 : src.indexOf('\n');
      if (nl !== -1) {
        const nl2 = src.indexOf('\n', nl + 1);
        const end = nl2 === -1 ? src.length : nl2;
        for (let k = nl + 1; k < end; k++) {
          if (src.charCodeAt(k) === PIPE) {
            tryTable = true;
            break;
          }
        }
      }
      if (tryTable && (token = this.block.table(src)) !== undefined) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      if (hasSetextUnderline(src) && (token = this.block.lheading(src)) !== undefined) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }

      if (this.state.top && (token = this.block.paragraph(src)) !== undefined) {
        const last = tokens[tokens.length - 1];
        if (inBlockquote && last !== undefined && last.type === 'paragraph') {
          last.raw += (last.raw.endsWith('\n') ? '' : '\n') + token.raw;
          last.text += '\n' + token.text;
          this.inlineQueue.pop();
          this.inlineQueue[this.inlineQueue.length - 1].src = last.text;
        } else {
          tokens.push(token);
        }
        inBlockquote = false;
        src = src.substring(token.raw.length);
        continue;
      }

      if ((token = this.block.text(src)) !== undefined) {
        src = src.substring(token.raw.length);
        const last = tokens[tokens.length - 1];
        if (last !== undefined && last.type === 'text') {
          last.raw += (last.raw.endsWith('\n') ? '' : '\n') + token.raw;
          last.text += '\n' + token.text;
          this.inlineQueue.pop();
          this.inlineQueue[this.inlineQueue.length - 1].src = last.text;
        } else {
          tokens.push(token);
        }
        continue;
      }

      if (src.length > 0) {
        this.infiniteLoopError(src.charCodeAt(0));
        break;
      }
    }
    this.state.top = true;
    return tokens;
  }

  inline(src, tokens = []) {
    this.inlineQueue.push({ src, tokens });
    return tokens;
  }

  inlineTokens(src, tokens = []) {
    const state = this.state;
    const old = state.linkParenPossible;
    state.linkParenPossible = old && src.indexOf(')') !== -1;
    if (src.indexOf('*') === -1 && src.indexOf('_') === -1 && src.indexOf('~') === -1) {
      // No emphasis delimiter anywhere: marked's mask would return the text unchanged, so
      // skip it (and the mask stack entry) entirely.
      const out = this.inlineScanner.run(src, src, tokens);
      state.linkParenPossible = old;
      return out;
    }
    try {
      const masked = this.mask(src);
      this.inlineScanner.maskStack.push({ src: masked, info: null });
      try {
        return this.inlineScanner.run(src, masked, tokens);
      } finally {
        this.inlineScanner.maskStack.pop();
      }
    } finally {
      state.linkParenPossible = old;
    }
  }

  /**
   * marked's `#n`: blank out the constructs that must not take part in emphasis matching.
   * Each pass is guarded, so text with no link definition, no code span, no escape and no
   * inline HTML is returned untouched without any regex running over it.
   */
  mask(src) {
    let masked = src;
    if (this.haveLinks && src.indexOf('[') !== -1 && this.reflinkPossible(src)) {
      const links = this.tokens.links;
      const reflinkSearch = inline.reflinkSearch;
      const replace = (match) => {
        const at = match.lastIndexOf('[');
        if (!Object.hasOwn(links, normalizeLabel(match.slice(at + 1, -1)))) return match;
        if (at > 1 && match.charAt(0) !== '!') {
          const inner = match.slice(1, at - 1);
          if (this.linkInText(inner)) {
            return '[' + inner.replace(reflinkSearch, replace) + '][' + 'a'.repeat(match.length - at - 2) + ']';
          }
        }
        return '[' + 'a'.repeat(match.length - 2) + ']';
      };
      masked = masked.replace(reflinkSearch, replace);
    }
    if (masked.indexOf('`') !== -1 || masked.indexOf('\\') !== -1) {
      masked = masked.replace(inline.anyPunctuationOutsideCode, (m, s, r) =>
        r ? '+'.repeat(m.length) : s ? s + m.slice(s.length, -s.length).replace(/`/g, '+') + s : m,
      );
    }
    if ((masked.indexOf('[') !== -1 && masked.indexOf('(') !== -1) || masked.indexOf('`') !== -1 || masked.indexOf('<') !== -1) {
      masked = masked.replace(inline.blockSkip, (m, s, r) => {
        const len = r ? r.length : 0;
        return m.slice(0, len) + '[' + 'a'.repeat(m.length - len - 2) + ']';
      });
    }
    return masked;
  }

  /** A reference link needs a `]` that is not the start of an inline link's `](`. */
  reflinkPossible(src) {
    let i = src.indexOf(']');
    while (i !== -1) {
      if (src.charCodeAt(i + 1) !== 40) return true;
      i = src.indexOf(']', i + 1);
    }
    return false;
  }

  linkInText(src) {
    if (src.indexOf('[') === -1) return false;
    const linkRe = inline.link;
    for (const m of src.matchAll(inline.blockSkip)) {
      if (linkRe.test(m[0]) && src.charAt(m.index - 1) !== '!') return true;
    }
    for (const m of src.matchAll(inline.reflinkSearch)) {
      const s = m[0];
      const at = s.lastIndexOf('[');
      if (!(s.charAt(0) === '!' || !Object.hasOwn(this.tokens.links, normalizeLabel(s.slice(at + 1, -1))))) {
        if (!(at > 1 && this.linkInText(s.slice(1, at - 1)))) return true;
      }
    }
    return false;
  }

  infiniteLoopError(byte) {
    throw new Error('Infinite loop on byte: ' + byte);
  }
}
