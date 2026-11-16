// The inline tokenizer: a port of marked 18.1.3's inline tokenizer (MIT; see
// vendor/marked/LICENSE), specialised to the default configuration (gfm on, breaks off).
//
// The rules are marked's, in marked's order. The driver differs in one way: instead of
// offering every rule the source at every position, it switches on the first code unit and
// calls only the rules that can match there. The text rule is still marked's, so a run of
// ordinary text is consumed in one step with exactly marked's boundaries.

import { inline, other } from './rules.js';
import { cpLen, findClosingBracket, linkInLabel, normalizeLabel, stripTrailing, unescapeEntities } from './util.js';

const STAR = 42;
const UNDER = 95;
const TILDE = 126;

/** Code-point length of the first code point of `s`. */
function firstCpLen(s) {
  const c = s.charCodeAt(0);
  if (c >= 0xd800 && c <= 0xdbff && s.length > 1) {
    const d = s.charCodeAt(1);
    if (d >= 0xdc00 && d <= 0xdfff) return 2;
  }
  return 1;
}

/** Local-part character of the url rule's e-mail form: [A-Za-z0-9._+-]. */
function isLocalStart(c) {
  return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 46 || c === 95 || c === 43 || c === 45;
}

/** First code units the url rule can start with: h H f F w W m M x X (protocol, www, e-mail). */
const URL_START = new Uint8Array(128);
for (const c of [104, 72, 102, 70, 119, 87, 109, 77, 120, 88]) URL_START[c] = 1;

/** Does `src` start with `[A-Za-z0-9._+-]+@`? A cheap pre-check before the url rule. */
function maybeEmail(src) {
  const n = src.length;
  let i = 0;
  for (; i < n; i++) {
    const c = src.charCodeAt(i);
    if (!((c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 46 || c === 95 || c === 43 || c === 45)) break;
  }
  return i > 0 && i < n && src.charCodeAt(i) === 64;
}

export class InlineScanner {
  constructor(lexer) {
    this.lexer = lexer;
    this.maskStack = [];
  }

  /** marked's `fe`: the last index at which a run of each marker can close emphasis. */
  static maskInfo(src) {
    let ast = -1;
    let und = -1;
    let del = -1;
    const n = src.length;
    for (let i = 0; i < n; i++) {
      const c = src.charCodeAt(i);
      if (c !== STAR && c !== UNDER && c !== TILDE) continue;
      const prev = i === 0 ? 10 : src.charCodeAt(i - 1);
      let j = i + 1;
      while (j < n && src.charCodeAt(j) === c) j++;
      if (prev !== 32 && prev !== 9 && prev !== 10 && prev !== 13 && prev !== 12) {
        if (c === TILDE) del = i;
        else if (c === STAR) ast = i;
        else und = i;
      }
      i = j - 1;
    }
    return { ast, und, del };
  }

  lastPossible(masked, marker) {
    const stack = this.maskStack;
    const top = stack.length > 0 ? stack[stack.length - 1] : undefined;
    let info;
    if (top !== undefined && top.src === masked) {
      info = top.info;
      if (info === null) {
        info = InlineScanner.maskInfo(masked);
        top.info = info;
      }
    } else {
      info = InlineScanner.maskInfo(masked);
    }
    return marker === STAR ? info.ast : marker === UNDER ? info.und : info.del;
  }

  escape(src) {
    const cap = inline.escape.exec(src);
    if (cap !== null) return { type: 'escape', raw: cap[0], text: cap[1] };
  }

  tag(src) {
    const cap = inline.tag.exec(src);
    if (cap === null) return;
    const state = this.lexer.state;
    if (!state.inLink && other.startATag.test(cap[0])) state.inLink = true;
    else if (state.inLink && other.endATag.test(cap[0])) state.inLink = false;
    if (!state.inRawBlock && other.startPreScriptTag.test(cap[0])) state.inRawBlock = true;
    else if (state.inRawBlock && other.endPreScriptTag.test(cap[0])) state.inRawBlock = false;
    return { type: 'html', raw: cap[0], inLink: state.inLink, inRawBlock: state.inRawBlock, block: false, text: cap[0] };
  }

  makeLink(cap, link, raw) {
    const lexer = this.lexer;
    const state = lexer.state;
    const text = cap[1].replace(other.outputLinkReplace, '$1');
    const isImage = cap[0].charAt(0) === '!';
    const oldInLink = state.inLink;
    const oldLinkEmitted = state.linkEmitted;
    const oldInRawBlock = state.inRawBlock;
    state.inLink = true;
    state.linkEmitted = false;
    const tokens = lexer.inlineTokens(text);
    const emitted = state.linkEmitted;
    state.linkEmitted = oldLinkEmitted;
    state.inLink = oldInLink;
    if (!isImage) {
      if (emitted) {
        state.inRawBlock = oldInRawBlock;
        return;
      }
      state.linkEmitted = true;
    }
    return { type: isImage ? 'image' : 'link', raw, href: link.href, title: link.title || null, text, tokens };
  }

  link(src) {
    if (this.lexer.state.linkParenPossible === false) return;
    const cap = inline.link.exec(src);
    if (cap === null) return;
    const offset = cap[0].charAt(0) === '!' ? 2 : 1;
    if (linkInLabel(src, cap[1], offset, inline)) return;

    const url = cap[2].trim();
    if (other.startAngleBracket.test(url)) {
      if (!other.endAngleBracket.test(url)) return;
      const stripped = stripTrailing(url.slice(0, -1), '\\');
      if ((url.length - stripped.length) % 2 === 0) return;
    } else {
      const idx = findClosingBracket(cap[2], '()');
      if (idx === -2) return;
      if (idx > -1) {
        const end = (cap[0].charCodeAt(0) === 33 ? 5 : 4) + cap[1].length + idx;
        cap[2] = cap[2].substring(0, idx);
        cap[0] = cap[0].substring(0, end).trim();
        cap[3] = '';
      }
    }

    const stripped = stripTrailing(cap[0].slice(0, -1), '\\');
    if ((cap[0].length - stripped.length) % 2 === 0) return;

    let href = cap[2];
    const title = cap[3] ? cap[3].slice(1, -1) : '';
    href = href.trim();
    if (other.startAngleBracket.test(href)) href = href.slice(1, -1);
    return this.makeLink(
      cap,
      {
        href: href && href.replace(inline.anyPunctuation, '$1'),
        title: title && title.replace(inline.anyPunctuation, '$1'),
      },
      cap[0],
    );
  }

  reflink(src, links) {
    const cap = inline.reflink.exec(src) || inline.nolink.exec(src);
    if (cap === null) return;
    const offset = cap[0].charAt(0) === '!' ? 2 : 1;
    if (linkInLabel(src, cap[1], offset, inline)) return;
    const link = links[normalizeLabel(cap[2] || cap[1])];
    if (link === undefined) {
      const ch = cap[0].charAt(0);
      return { type: 'text', raw: ch, text: ch };
    }
    return this.makeLink(cap, link, cap[0]);
  }

  emStrong(src, masked, prevChar = '') {
    const cap = inline.emStrongLDelim.exec(src);
    if (cap === null) return;
    if (!cap[1] && !cap[2] && !cap[3] && !cap[4]) return;

    const marker = cap[0].charCodeAt(0);
    const sameAsPrev = prevChar === cap[0][0];
    const startIndex = masked.length - src.length;
    let lastIndex = startIndex;
    while (lastIndex > 0 && masked.charCodeAt(lastIndex - 1) === marker) lastIndex--;

    const tail = masked.slice(Math.max(0, lastIndex - 2), lastIndex);
    let lastChar = '';
    if (tail.length > 0) {
      const c = tail.charCodeAt(tail.length - 1);
      lastChar = c >= 0xdc00 && c <= 0xdfff && tail.length > 1 ? tail.slice(-2) : tail.slice(-1);
    }
    const lastPunct = lastChar === '*' || lastChar === '_' || inline.punctuation.test(lastChar);
    if (lastIndex < startIndex) prevChar = lastChar;
    const isPunct = lastIndex < startIndex ? lastPunct : inline.punctuation.test(prevChar);

    if (cap[4] && other.unicodeAlphaNumeric.test(prevChar)) return;

    const delimChar = cap[1] || cap[3] || '';
    if (!delimChar || !prevChar || isPunct) {
      const markerLen = cap[0].length - 1;
      let openLen = markerLen;
      let closerCount = 0;
      const totalLen = startIndex - lastIndex + markerLen;
      const canClose = !!lastChar.trim() && (!!delimChar || (marker === STAR && !lastPunct));
      if (marker !== STAR && marker !== UNDER) return;
      const rule = marker === STAR ? inline.emStrongRDelimAst : inline.emStrongRDelimUnd;
      const lastPossible = this.lastPossible(masked, marker);
      const maxIndex = masked.length - src.length + markerLen;
      if (lastPossible < maxIndex) return;
      const hay = masked.slice(maxIndex);
      const limit = lastPossible - maxIndex;
      rule.lastIndex = 0;
      let m;
      while ((m = rule.exec(hay)) !== null && !(m.index > limit)) {
        const run = m[1] || m[2] || m[3] || m[4] || m[5] || m[6];
        if (!run) continue;
        let runLen = run.length;
        if (m[3] || m[4]) {
          openLen += runLen;
          continue;
        } else if (m[5] || m[6] || canClose) {
          if (sameAsPrev && (m[5] || m[6])) break;
          if (totalLen % 3 && !((totalLen + runLen) % 3)) {
            closerCount += runLen;
            continue;
          }
        }
        openLen -= runLen;
        if (openLen > 0) continue;
        runLen = Math.min(runLen, runLen + openLen + closerCount);
        const raw = src.slice(0, markerLen + m.index + firstCpLen(m[0]) + runLen);
        if (Math.min(markerLen, runLen) % 2) {
          const text = raw.slice(1, -1);
          return { type: 'em', raw, text, tokens: this.lexer.inlineTokens(text) };
        }
        const text = raw.slice(2, -2);
        return { type: 'strong', raw, text, tokens: this.lexer.inlineTokens(text) };
      }
    }
  }

  codespan(src) {
    const cap = inline.code.exec(src);
    if (cap === null) return;
    let text = cap[2].replace(other.newLineCharGlobal, ' ');
    const hasNonSpace = other.nonSpaceChar.test(text);
    const padded = other.startingSpaceChar.test(text) && other.endingSpaceChar.test(text);
    if (hasNonSpace && padded) text = text.substring(1, text.length - 1);
    return { type: 'codespan', raw: cap[0], text };
  }

  br(src) {
    const cap = inline.br.exec(src);
    if (cap !== null) return { type: 'br', raw: cap[0] };
  }

  del(src, masked, prevChar = '') {
    const cap = inline.delLDelim.exec(src);
    if (cap === null) return;
    if (!(cap[1] || '') || !prevChar || inline.punctuation.test(prevChar)) {
      const len = cpLen(cap[0]) - 1;
      let openLen = len;
      const rule = inline.delRDelim;
      const lastPossible = this.lastPossible(masked, TILDE);
      const start = masked.length - src.length + len;
      if (lastPossible < start) return;
      const hay = masked.slice(start);
      const limit = lastPossible - start;
      rule.lastIndex = 0;
      let m;
      while ((m = rule.exec(hay)) !== null && !(m.index > limit)) {
        const run = m[1] || m[2] || m[3] || m[4] || m[5] || m[6];
        if (!run) continue;
        const runLen = run.length;
        if (runLen !== len) continue;
        if (m[3] || m[4]) {
          openLen += runLen;
          continue;
        }
        openLen -= runLen;
        if (openLen > 0) continue;
        const finalLen = Math.min(runLen, runLen + openLen);
        const raw = src.slice(0, len + m.index + firstCpLen(m[0]) + finalLen);
        const text = raw.slice(len, -len);
        return { type: 'del', raw, text, tokens: this.lexer.inlineTokens(text) };
      }
    }
  }

  autolink(src) {
    const cap = inline.autolink.exec(src);
    if (cap === null) return;
    const text = cap[1];
    const href = cap[2] === '@' ? 'mailto:' + text : text;
    return { type: 'link', raw: cap[0], text, href, autolink: true, tokens: [{ type: 'text', raw: text, text }] };
  }

  url(src) {
    const cap = inline.url.exec(src);
    if (cap === null) return;
    let text;
    let href;
    if (cap[2] === '@') {
      text = cap[0];
      href = 'mailto:' + text;
    } else {
      let last;
      do {
        last = cap[0];
        const back = inline._backpedal.exec(cap[0]);
        cap[0] = back !== null ? back[0] : '';
      } while (last !== cap[0]);
      text = cap[0];
      href = cap[1] === 'www.' ? 'http://' + cap[0] : cap[0];
    }
    return { type: 'link', raw: cap[0], text, href, autolink: true, tokens: [{ type: 'text', raw: text, text }] };
  }

  /** marked's `#t`: the inline token loop, dispatching on the first code unit. */
  run(src, masked, out) {
    let prevChar = '';
    let fromText = false;
    let shortest = Infinity;
    let rest = src;
    const lexer = this.lexer;
    const state = lexer.state;
    const links = lexer.tokens.links;

    while (rest.length > 0) {
      const len = rest.length;
      if (len < shortest) shortest = len;
      else {
        lexer.infiniteLoopError(rest.charCodeAt(0));
        break;
      }

      if (!fromText) prevChar = '';
      fromText = false;

      const c = rest.charCodeAt(0);
      let token;

      if (c === 92) {
        // backslash: escape, then a hard line break
        if ((token = this.escape(rest)) !== undefined) {
          rest = rest.substring(token.raw.length);
          out.push(token);
          continue;
        }
        if ((token = this.br(rest)) !== undefined) {
          rest = rest.substring(token.raw.length);
          out.push(token);
          continue;
        }
      } else if (c === 60) {
        // <: html tag, then autolink
        if ((token = this.tag(rest)) !== undefined) {
          rest = rest.substring(token.raw.length);
          out.push(token);
          continue;
        }
        if ((token = this.autolink(rest)) !== undefined) {
          rest = rest.substring(token.raw.length);
          out.push(token);
          continue;
        }
      } else if (c === 33 || c === 91) {
        // ! or [: inline link, then reference link
        if ((token = this.link(rest)) !== undefined) {
          rest = rest.substring(token.raw.length);
          out.push(token);
          continue;
        }
        if ((token = this.reflink(rest, links)) !== undefined) {
          rest = rest.substring(token.raw.length);
          const last = out[out.length - 1];
          if (token.type === 'text') {
            if (typeof last === 'string') out[out.length - 1] = last + token.text;
            else if (last !== undefined && last.type === 'text') {
              last.raw += token.raw;
              last.text += token.text;
            } else out.push(token.text);
          } else out.push(token);
          continue;
        }
      } else if (c === 42 || c === 95) {
        if ((token = this.emStrong(rest, masked, prevChar)) !== undefined) {
          rest = rest.substring(token.raw.length);
          out.push(token);
          continue;
        }
      } else if (c === 96) {
        if ((token = this.codespan(rest)) !== undefined) {
          rest = rest.substring(token.raw.length);
          out.push(token);
          continue;
        }
      } else if (c === 126) {
        if ((token = this.del(rest, masked, prevChar)) !== undefined) {
          rest = rest.substring(token.raw.length);
          out.push(token);
          continue;
        }
      } else if (c === 10 || c === 32) {
        if ((token = this.br(rest)) !== undefined) {
          rest = rest.substring(token.raw.length);
          out.push(token);
          continue;
        }
      }

      if (!state.inLink) {
        if (c < 128 && URL_START[c] === 1) {
          if ((token = this.url(rest)) !== undefined) {
            rest = rest.substring(token.raw.length);
            out.push(token);
            continue;
          }
        } else if (isLocalStart(c) && maybeEmail(rest)) {
          if ((token = this.url(rest)) !== undefined) {
            rest = rest.substring(token.raw.length);
            out.push(token);
            continue;
          }
        }
      }

      const cap = inline.text.exec(rest);
      if (cap !== null) {
        const raw = cap[0];
        rest = rest.substring(raw.length);
        if (raw.charCodeAt(raw.length - 1) !== 95) prevChar = raw.charAt(raw.length - 1);
        fromText = true;
        // A plain text run is stored as the string itself, not as a token object: it is by
        // far the most common token, the renderer only needs its text, and merging two runs
        // is then one string concatenation instead of two property updates.
        if (state.inRawBlock) {
          const last = out[out.length - 1];
          if (last !== undefined && typeof last !== 'string' && last.type === 'text') {
            last.raw += raw;
            last.text += raw;
          } else {
            out.push({ type: 'text', raw, text: raw, escaped: true });
          }
        } else {
          const text = unescapeEntities(raw);
          const last = out[out.length - 1];
          if (typeof last === 'string') out[out.length - 1] = last + text;
          else out.push(text);
        }
        continue;
      }

      if (rest.length > 0) {
        lexer.infiniteLoopError(rest.charCodeAt(0));
        break;
      }
    }
    return out;
  }
}
