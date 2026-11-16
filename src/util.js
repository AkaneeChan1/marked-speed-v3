// Shared helpers. Each is a port of the matching helper in marked 18.1.3 (MIT; see
// vendor/marked/LICENSE), kept behaviourally identical but written to avoid needless
// allocation: no per-character string building, and early returns before any regex runs.

import { other } from './rules.js';

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const entityChar = (c) => ENTITIES[c];

/** HTML-escape `html`; `encode` also escapes ampersands that are not character references. */
export function escape(html, encode) {
  if (encode) {
    if (other.escapeTest.test(html)) return html.replace(other.escapeReplace, entityChar);
    return html;
  }
  if (other.escapeTestNoEncode.test(html)) return html.replace(other.escapeReplaceNoEncode, entityChar);
  return html;
}

/**
 * marked's `Ie`: numeric character references are decoded, a bare `&` becomes `&amp;`,
 * and a NUL/surrogate/out-of-range code point becomes U+FFFD.
 */
export function unescapeEntities(text) {
  if (text.indexOf('&') === -1) return text;
  // One global replace: it returns the input untouched when nothing matches, so a separate
  // test would only scan the same text twice.
  return text.replace(other.numericCharacterReferenceOrAmpersand, (m, dec, hex) => {
    if (dec === undefined && hex === undefined) return '&amp;';
    const code = dec === undefined ? Number.parseInt(hex, 16) : Number.parseInt(dec, 10);
    if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '\uFFFD';
    if (code === 38) return '&amp;';
    return String.fromCodePoint(code);
  });
}

/** Percent-encode a URL the way marked does; null when encodeURI throws. */
export function encodeUrl(href) {
  try {
    return encodeURI(href).replace(other.percentDecode, '%');
  } catch {
    return null;
  }
}

/**
 * Split a table row into cells. marked first rewrites every `|` as ` |` unless it is
 * escaped by an odd number of backslashes, then splits on ` |`, drops an empty first or
 * last cell, pads/truncates to `count`, and trims each cell.
 */
export function splitRow(row, count) {
  let escaped = '';
  let last = 0;
  let pipe = row.indexOf('|');
  while (pipe !== -1) {
    let slashes = 0;
    let i = pipe;
    while (--i >= 0 && row.charCodeAt(i) === 92) slashes++;
    escaped += row.slice(last, pipe) + (slashes % 2 ? '|' : ' |');
    last = pipe + 1;
    pipe = row.indexOf('|', last);
  }
  escaped += row.slice(last);
  let cells = escaped.split(other.splitPipe);
  if (!cells[0].trim()) cells.shift();
  if (cells.length > 0 && !cells[cells.length - 1].trim()) cells.pop();
  if (count) {
    if (cells.length > count) cells.length = count;
    else while (cells.length < count) cells.push('');
  }
  for (let i = 0; i < cells.length; i++) cells[i] = cells[i].trim().replace(other.slashPipe, '|');
  return cells;
}

/** Strip trailing occurrences of `ch` (or of everything but `ch` when `invert`). */
export function stripTrailing(str, ch, invert) {
  const n = str.length;
  if (n === 0) return '';
  const code = ch.charCodeAt(0);
  let i = 0;
  while (i < n) {
    const c = str.charCodeAt(n - i - 1);
    if (c === code ? !invert : invert) i++;
    else break;
  }
  return i === 0 ? str : str.slice(0, n - i);
}

/**
 * marked's `ge`: drop trailing blank lines, but leave the string untouched when at most
 * one line would go. Scans backwards instead of splitting and re-joining.
 */
export function trimTrailingBlankLines(src) {
  const n = src.length;
  let end = n;
  let blankLines = 0;
  for (;;) {
    let start = src.lastIndexOf('\n', end - 1);
    start = start < 0 ? 0 : start + 1;
    let blank = true;
    for (let i = start; i < end; i++) {
      const c = src.charCodeAt(i);
      if (c !== 32 && c !== 9) {
        blank = false;
        break;
      }
    }
    if (!blank) {
      return blankLines <= 1 ? src : src.slice(0, end);
    }
    blankLines++;
    end = start - 1;
    if (end <= 0) return blankLines <= 1 ? src : '';
  }
}

/**
 * Normalise a link label the way marked does: trim, collapse runs of whitespace, then
 * lower/upper/lower case-fold. Labels that are already plain ASCII skip all of it.
 */
export function normalizeLabel(label) {
  const n = label.length;
  let plain = true;
  for (let i = 0; i < n; i++) {
    const c = label.charCodeAt(i);
    if (c >= 128 || c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || (c >= 65 && c <= 90)) {
      plain = false;
      break;
    }
  }
  if (plain) return label;
  return label.trim().replace(other.multipleSpaceGlobal, ' ').toLowerCase().toUpperCase().toLowerCase();
}

/**
 * marked's `ke`: the index of the bracket closing the one at the start of `str`, -1 when
 * there is none, -2 when a bracket is left open. Backslash escapes are skipped.
 */
export function findClosingBracket(str, pair) {
  const open = pair.charCodeAt(0);
  const close = pair.charCodeAt(1);
  if (str.indexOf(pair[0]) === -1 && str.indexOf(pair[1]) === -1) return -1;
  let depth = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c === 92) i++;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth < 0) return i;
    }
  }
  return depth > 0 ? -2 : -1;
}

/** Expand tabs to 4-column stops, starting at column `start`. */
export function expandTabs(str, start = 0) {
  if (str.indexOf('\t') === -1) return str;
  let col = start;
  let out = '';
  let last = 0;
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) === 9) {
      out += str.slice(last, i);
      const width = 4 - (col % 4);
      out += ' '.repeat(width);
      col += width;
      last = i + 1;
    } else {
      col++;
    }
  }
  return out + str.slice(last);
}

/** Remove the fence's own indentation from every line of a fenced code block. */
export function compensateIndent(raw, text) {
  const m = other.indentCodeCompensation.exec(raw);
  if (m === null) return text;
  const indent = m[1].length;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let lead = 0;
    while (lead < line.length && (line.charCodeAt(lead) === 32 || line.charCodeAt(lead) === 9)) lead++;
    if (lead > 0) lines[i] = line.slice(Math.min(lead, indent));
  }
  return lines.join('\n');
}

/**
 * marked's `Be`: true when a link label contains an inline tag or autolink that would
 * swallow the closing bracket. Code spans and escapes are skipped.
 */
export function linkInLabel(src, label, offset, inlineRules) {
  if (!label.includes('<')) return false;
  for (let i = 0; i < label.length; i++) {
    const c = label.charCodeAt(i);
    if (c === 92) {
      i++;
      continue;
    }
    if (c === 96) {
      const m = inlineRules.code.exec(label.slice(i));
      if (m) {
        i += m[0].length - 1;
        continue;
      }
    }
    if (c !== 60) continue;
    const rest = src.slice(offset + i);
    const m = inlineRules.tag.exec(rest) || inlineRules.autolink.exec(rest);
    if (m) {
      if (m[0].length > label.length - i) return true;
      i += m[0].length - 1;
    }
  }
  return false;
}

/** Number of code points in `str` (marked spreads the string into an array). */
export function cpLen(str) {
  let n = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const d = str.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
    }
    n++;
  }
  return n;
}
