// The block scanner: a port of marked 18.1.3's block tokenizer (MIT; see
// vendor/marked/LICENSE), specialised to the default configuration (gfm on, pedantic off).
//
// The only structural change from marked is that the list-item continuation loop walks the
// source by index instead of re-slicing it per line, and only materialises a line string
// when a rule actually has to see it.

import {
  block,
  inline,
  blockquoteBeginRegex,
  fencesBeginRegex,
  headingBeginRegex,
  hrRegex,
  htmlBeginRegex,
  listItemRegex,
  nextBulletRegex,
  other,
} from './rules.js';
import {
  compensateIndent,
  expandTabs,
  findClosingBracket,
  normalizeLabel,
  splitRow,
  stripTrailing,
  trimTrailingBlankLines,
} from './util.js';

const SETEXT_LINE = /^ {0,3}(?:=+|-+) *$/;

/** `s.trim().length === 0`, without allocating the trimmed string. */
function isBlank(s) {
  const n = s.length;
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    if (c !== 32 && c !== 9) {
      // \v, \f, \r and non-ASCII whitespace are all trimmed by String#trim.
      if (c === 11 || c === 12 || c === 13 || c > 127) return s.trim().length === 0;
      return false;
    }
  }
  return true;
}

/** Index of the first character that is neither a space nor a tab, or -1. */
function firstNonSpace(s) {
  const n = s.length;
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    if (c !== 32 && c !== 9) return i;
  }
  return -1;
}

/** `/^\s+/` length: leading whitespace, with tabs counting as one character here. */
function leadingWhitespace(s) {
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c === 32 || c === 9) i++;
    else break;
  }
  if (i < n) {
    const c = s.charCodeAt(i);
    if (c === 11 || c === 12 || c === 13 || c === 0x85 || c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff) {
      const m = other.beginningSpace.exec(s);
      return m === null ? 0 : m[0].length;
    }
  }
  return i;
}

/** `/\\n[ \\t]*\\n[ \\t]*$/` without scanning the whole item: true when it ends in a blank line. */
function endsWithBlankLine(s) {
  let i = s.length - 1;
  while (i >= 0 && (s.charCodeAt(i) === 32 || s.charCodeAt(i) === 9)) i--;
  if (i < 0 || s.charCodeAt(i) !== 10) return false;
  i--;
  while (i >= 0 && (s.charCodeAt(i) === 32 || s.charCodeAt(i) === 9)) i--;
  return i >= 0 && s.charCodeAt(i) === 10;
}

/**
 * Does the line at [pos, end) start a block that ends the current list item? Equivalent to
 * running fencesBeginRegex || headingBeginRegex || htmlBeginRegex || blockquoteBeginRegex ||
 * nextBulletRegex || hrRegex at that indent, but only the rule that can match is run.
 */
function breaksListItem(src, pos, end, indent, r) {
  let i = pos;
  const lim = pos + indent;
  while (i < end && i < lim && src.charCodeAt(i) === 32) i++;
  if (i >= end) return false;
  const c = src.charCodeAt(i);
  if (c === 96 || c === 126) return r.fences.test(src.slice(pos, end));
  if (c === 35) return r.heading.test(src.slice(pos, end));
  if (c === 60) return r.html.test(src.slice(pos, end));
  if (c === 62) return r.blockquote.test(src.slice(pos, end));
  if (c === 42 || c === 43 || c === 45) {
    const line = src.slice(pos, end);
    return r.bullet.test(line) || r.hr.test(line);
  }
  if (c === 95) return r.hr.test(src.slice(pos, end));
  if (c >= 48 && c <= 57) return r.bullet.test(src.slice(pos, end));
  return false;
}

/** The narrower set: fence, heading, html or hr at this indent. Takes the line string. */
function breaksItemContinuation(line, indent) {
  let i = 0;
  const n = line.length;
  while (i < indent && i < n && line.charCodeAt(i) === 32) i++;
  if (i >= n) return false;
  const c = line.charCodeAt(i);
  if (c === 96 || c === 126) return fencesBeginRegex(indent).test(line);
  if (c === 35) return headingBeginRegex(indent).test(line);
  if (c === 60) return htmlBeginRegex(indent).test(line);
  if (c === 42 || c === 45 || c === 95) return hrRegex(indent).test(line);
  return false;
}

/** marked's `/[^ ]/.search` after replacing every tab with four spaces: is it at index >= 4? */
function indentedByFour(line) {
  let col = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c === 32) col++;
    else if (c === 9) col += 4;
    else return col >= 4;
  }
  return false;
}

export class BlockScanner {
  constructor(lexer) {
    this.lexer = lexer;
  }

  space(src) {
    const cap = block.newline.exec(src);
    if (cap !== null && cap[0].length > 0) return { type: 'space', raw: cap[0] };
  }

  code(src) {
    const cap = block.code.exec(src);
    if (cap === null) return;
    const raw = trimTrailingBlankLines(cap[0]);
    return { type: 'code', raw, codeBlockStyle: 'indented', text: raw.replace(other.codeRemoveIndent, '') };
  }

  fences(src) {
    const cap = block.fences.exec(src);
    if (cap === null) return;
    const raw = cap[0];
    const info = cap[2];
    return {
      type: 'code',
      raw,
      lang: info ? info.trim().replace(inline.anyPunctuation, '$1') : info,
      text: compensateIndent(raw, cap[3] || ''),
    };
  }

  heading(src) {
    const cap = block.heading.exec(src);
    if (cap === null) return;
    let text = cap[2].trim();
    if (other.endingHash.test(text)) {
      const trimmed = stripTrailing(text, '#');
      if (!trimmed || other.endingSpaceTabChar.test(trimmed)) text = trimmed.trim();
    }
    return { type: 'heading', raw: stripTrailing(cap[0], '\n'), depth: cap[1].length, text, tokens: this.lexer.inline(text) };
  }

  hr(src) {
    const cap = block.hr.exec(src);
    if (cap !== null) return { type: 'hr', raw: stripTrailing(cap[0], '\n') };
  }

  blockquote(src) {
    const cap = block.blockquote.exec(src);
    if (cap === null) return;

    let lines = stripTrailing(cap[0], '\n').split('\n');
    let raw = '';
    let text = '';
    const tokens = [];

    while (lines.length > 0) {
      let inBlock = false;
      const blockLines = [];
      let i = 0;
      for (; i < lines.length; i++) {
        if (other.blockquoteStart.test(lines[i])) {
          blockLines.push(lines[i]);
          inBlock = true;
        } else if (!inBlock) blockLines.push(lines[i]);
        else break;
      }
      lines = lines.slice(i);

      const blockRaw = blockLines.join('\n');
      const blockText = blockRaw
        .replace(other.blockquoteMarkerWhitespace, (m, marker, ws) => marker + expandTabs(ws, marker.length))
        .replace(other.blockquoteSetextReplace, '\n    $1')
        .replace(other.blockquoteSetextReplace2, '');
      raw = raw ? raw + '\n' + blockRaw : blockRaw;
      text = text ? text + '\n' + blockText : blockText;

      const oldTop = this.lexer.state.top;
      this.lexer.state.top = true;
      this.lexer.blockTokens(blockText, tokens, true);
      this.lexer.state.top = oldTop;

      if (lines.length === 0) break;
      const last = tokens[tokens.length - 1];
      if (last === undefined) break;
      const type = last.type;
      if (type === 'code' || type === 'heading' || type === 'hr' || type === 'html' || type === 'table') break;
      if (type === 'blockquote') {
        const newRaw = last.raw + '\n' + lines.join('\n').replace(other.blockquoteSetextReplace2, '');
        const newToken = this.blockquote(newRaw);
        tokens[tokens.length - 1] = newToken;
        const remaining = newRaw.substring(newToken.raw.length).replace(/^\n/, '');
        const remainingLines = remaining ? remaining.split('\n').length : 0;
        const consumed = remainingLines ? lines.slice(0, -remainingLines) : lines;
        if (consumed.length > 0) raw = raw + '\n' + consumed.join('\n');
        text = text.substring(0, text.length - last.text.length) + newToken.text;
        lines = lines.slice(consumed.length);
        if (lines.length > 0 && other.blockquoteStart.test(lines[0])) continue;
        break;
      } else if (type === 'list') {
        const newRaw = last.raw + '\n' + lines.join('\n');
        const newToken = this.list(newRaw);
        tokens[tokens.length - 1] = newToken;
        const consumed =
          newToken.raw.length > last.raw.length ? newRaw.slice(last.raw.length + 1, newToken.raw.length).split('\n').length : 0;
        if (consumed > 0) {
          const consumedLines = lines.slice(0, consumed).join('\n');
          raw = raw + '\n' + consumedLines;
          text = text + '\n' + consumedLines;
        }
        lines = lines.slice(consumed);
        continue;
      }
    }
    return { type: 'blockquote', raw, tokens, text };
  }

  list(src) {
    const cap = block.list.exec(src);
    if (cap === null) return;

    const original = src;
    let bullet = cap[1].trim();
    const ordered = bullet.length > 1;
    const token = {
      type: 'list',
      raw: '',
      ordered,
      start: ordered ? +bullet.slice(0, -1) : '',
      loose: false,
      items: [],
    };
    bullet = ordered ? '\\d{1,9}\\' + bullet.slice(-1) : '\\' + bullet;
    const itemRe = listItemRegex(bullet);

    const rules = {
      fences: fencesBeginRegex(0),
      heading: headingBeginRegex(0),
      html: htmlBeginRegex(0),
      blockquote: blockquoteBeginRegex(0),
      bullet: nextBulletRegex(0),
      hr: hrRegex(0),
    };
    let rulesIndent = 0;

    let looseSeen = false;
    while (src.length > 0) {
      let blankItem = false;
      let itemText = '';
      const item = itemRe.exec(src);
      if (item === null || block.hr.test(src)) break;

      const itemStart = original.length - src.length;
      src = src.substring(item[0].length);

      const firstRaw = item[2] || '';
      const firstNl = firstRaw.indexOf('\n');
      const firstLine = firstNl === -1 ? firstRaw : firstRaw.slice(0, firstNl);
      const bulletWidth = item[1].length;

      let line = firstLine;
      const firstC = firstLine.charCodeAt(0);
      if (firstC === 32 || firstC === 9) line = firstRaw.slice(0, firstLine.length).replace(other.leadingSpaceTab, (ws) => expandTabs(ws, bulletWidth));

      let blank = isBlank(line);
      let indent;
      if (blank) {
        indent = bulletWidth + 1;
      } else {
        const off = firstNonSpace(line);
        indent = off > 4 ? 1 : off;
        itemText = line.slice(indent);
        indent += bulletWidth;
      }

      if (blank) {
        const nl = src.indexOf('\n');
        const nextLine = nl === -1 ? src : src.slice(0, nl);
        if (other.blankLine.test(nextLine)) {
          src = src.substring(nextLine.length + 1);
          blankItem = true;
        }
      }

      if (!blankItem) {
        if (rulesIndent !== indent) {
          rules.fences = fencesBeginRegex(indent);
          rules.heading = headingBeginRegex(indent);
          rules.html = htmlBeginRegex(indent);
          rules.blockquote = blockquoteBeginRegex(indent);
          rules.bullet = nextBulletRegex(indent);
          rules.hr = hrRegex(indent);
          rulesIndent = indent;
        }

        const total = src.length;
        let pos = 0;
        // The line before the one being looked at: [prevPos, prevEnd), plus the number of
        // columns its leading whitespace expands to and where its content starts.
        let prevPos = 0;
        let prevEnd = 0;
        let prevCol = 0;
        let prevQ = 0;
        let prevTabbed = false;
        let prevIsHeader = true;
        let header = line;

        while (pos < total) {
          const nl = src.indexOf('\n', pos);
          const end = nl === -1 ? total : nl;

          let q = pos;
          let col = 0;
          let tabbed = false;
          for (;;) {
            if (q >= end) break;
            const c = src.charCodeAt(q);
            if (c === 32) {
              col++;
              q++;
            } else if (c === 9) {
              col += 4 - (col % 4);
              q++;
              tabbed = true;
            } else break;
          }

          if (breaksListItem(src, pos, end, indent, rules)) break;

          let blankLine = q >= end;
          if (!blankLine && (src.charCodeAt(q) === 11 || src.charCodeAt(q) === 12 || src.charCodeAt(q) === 13 || src.charCodeAt(q) > 127)) {
            blankLine = isBlank(src.slice(pos, end));
          }

          if (col >= indent || blankLine) {
            if (tabbed) itemText += '\n' + (' '.repeat(col) + src.slice(q, end)).slice(indent);
            else itemText += '\n' + (pos + indent >= end ? '' : src.slice(pos + indent, end));
          } else {
            // Lazy continuation. It is kept only when the previous line was not blank, was
            // not indented by four columns and did not start a block of its own.
            let prev;
            if (prevIsHeader) prev = header;
            else if (prevTabbed) prev = (' '.repeat(prevCol) + src.slice(prevQ, prevEnd)).slice(indent);
            else prev = prevPos + indent >= prevEnd ? '' : src.slice(prevPos + indent, prevEnd);

            if (blank || indentedByFour(prev) || breaksItemContinuation(prev, indent)) break;

            const rawLine = src.slice(pos, end);
            const setext =
              SETEXT_LINE.test(rawLine) && block.lheading.test(prev + '\n' + rawLine)
                ? '    ' + (tabbed ? ' '.repeat(col) + src.slice(q, end) : rawLine).replace(/^ {0,3}/, '')
                : rawLine;
            itemText += '\n' + setext;
          }

          blank = blankLine;
          prevPos = pos;
          prevEnd = end;
          prevCol = col;
          prevQ = q;
          prevTabbed = tabbed;
          prevIsHeader = false;
          pos = end + 1;
        }
        src = src.substring(pos);
      }

      const itemRaw = original.slice(itemStart, original.length - src.length);
      if (!token.loose) {
        if (looseSeen) token.loose = true;
        else if (endsWithBlankLine(itemRaw)) looseSeen = true;
      }
      token.items.push({
        type: 'list_item',
        raw: itemRaw,
        task: other.listIsTask.test(itemText),
        loose: false,
        text: itemText,
        tokens: [],
      });
    }

    const lastItem = token.items[token.items.length - 1];
    if (lastItem === undefined) return;
    lastItem.raw = lastItem.raw.trimEnd();
    lastItem.text = lastItem.text.trimEnd();
    token.raw = original.slice(0, original.length - src.length).trimEnd();

    for (let n = 0; n < token.items.length; n++) {
      const item = token.items[n];
      this.lexer.state.top = false;
      item.tokens = this.lexer.blockTokens(item.text, []);
      if (!token.loose) {
        for (let i = 0; i < item.tokens.length; i++) {
          const t = item.tokens[i];
          if (t.type === 'space' && other.anyLine.test(t.raw)) {
            token.loose = true;
            break;
          }
        }
      }
    }

    for (let n = 0; n < token.items.length; n++) {
      const item = token.items[n];
      const first = item.tokens[0];
      if (item.task && first !== undefined && (first.type === 'text' || first.type === 'paragraph')) {
        item.text = item.text.replace(other.listReplaceTask, '');
        first.raw = first.raw.replace(other.listReplaceTask, '');
        first.text = first.text.replace(other.listReplaceTask, '');
        const queue = this.lexer.inlineQueue;
        for (let i = queue.length - 1; i >= 0; i--) {
          if (other.listIsTask.test(queue[i].src)) {
            queue[i].src = queue[i].src.replace(other.listReplaceTask, '');
            break;
          }
        }
        const box = other.listTaskCheckbox.exec(item.raw);
        if (box !== null) {
          const checkbox = { type: 'checkbox', raw: box[0] + ' ', checked: box[0] !== '[ ]' };
          item.checked = checkbox.checked;
          if (token.loose) {
            const head = item.tokens[0];
            if (head !== undefined && (head.type === 'paragraph' || head.type === 'text') && head.tokens) {
              head.raw = checkbox.raw + head.raw;
              head.text = checkbox.raw + head.text;
              head.tokens.unshift(checkbox);
            } else {
              item.tokens.unshift({ type: 'paragraph', raw: checkbox.raw, text: checkbox.raw, tokens: [checkbox] });
            }
          } else {
            item.tokens.unshift(checkbox);
          }
        }
      } else if (item.task) {
        item.task = false;
      }
    }

    if (token.loose) {
      for (let n = 0; n < token.items.length; n++) {
        const item = token.items[n];
        item.loose = true;
        for (const t of item.tokens) if (t.type === 'text') t.type = 'paragraph';
      }
    }
    return token;
  }

  html(src) {
    const cap = block.html.exec(src);
    if (cap === null) return;
    const raw = trimTrailingBlankLines(cap[0]);
    const tag = cap[1];
    return { type: 'html', block: true, raw, pre: tag === 'pre' || tag === 'script' || tag === 'style', text: raw };
  }

  def(src) {
    const cap = block.def.exec(src);
    if (cap === null) return;
    if (!other.startAngleBracket.test(cap[2]) && findClosingBracket(cap[2], '()') !== -1) return;
    return {
      type: 'def',
      tag: normalizeLabel(cap[1]),
      raw: stripTrailing(cap[0], '\n'),
      href: cap[2] ? cap[2].replace(other.hrefBrackets, '$1').replace(inline.anyPunctuation, '$1') : '',
      title: cap[3] ? cap[3].substring(1, cap[3].length - 1).replace(inline.anyPunctuation, '$1') : cap[3],
    };
  }

  table(src) {
    const cap = block.table.exec(src);
    if (cap === null || !other.tableDelimiter.test(cap[2])) return;
    const header = splitRow(cap[1]);
    const aligns = cap[2].replace(other.tableAlignChars, '').split('|');
    if (header.length !== aligns.length) return;

    const rows = cap[3] && cap[3].trim() ? cap[3].replace(other.tableRowBlankLine, '').split('\n') : [];
    const token = { type: 'table', raw: stripTrailing(cap[0], '\n'), header: [], align: [], rows: [] };
    for (let i = 0; i < aligns.length; i++) {
      const cell = aligns[i];
      if (other.tableAlignRight.test(cell)) token.align.push('right');
      else if (other.tableAlignCenter.test(cell)) token.align.push('center');
      else if (other.tableAlignLeft.test(cell)) token.align.push('left');
      else token.align.push(null);
    }
    for (let i = 0; i < header.length; i++) {
      token.header.push({ text: header[i], tokens: this.lexer.inline(header[i]), header: true, align: token.align[i] });
    }
    for (let r = 0; r < rows.length; r++) {
      const cells = splitRow(rows[r], token.header.length);
      const out = [];
      for (let i = 0; i < cells.length; i++) {
        out.push({ text: cells[i], tokens: this.lexer.inline(cells[i]), header: false, align: token.align[i] });
      }
      token.rows.push(out);
    }
    return token;
  }

  lheading(src) {
    const cap = block.lheading.exec(src);
    if (cap === null) return;
    const text = cap[1].trim();
    return {
      type: 'heading',
      raw: stripTrailing(cap[0], '\n'),
      depth: cap[2].charAt(0) === '=' ? 1 : 2,
      text,
      tokens: this.lexer.inline(text),
    };
  }

  paragraph(src) {
    const cap = block.paragraph.exec(src);
    if (cap === null) return;
    const text = cap[1].charAt(cap[1].length - 1) === '\n' ? cap[1].slice(0, -1) : cap[1];
    return { type: 'paragraph', raw: cap[0], text, tokens: this.lexer.inline(text) };
  }

  text(src) {
    const cap = block.text.exec(src);
    if (cap === null) return;
    return { type: 'text', raw: cap[0], text: cap[0], tokens: this.lexer.inline(cap[0]) };
  }
}
