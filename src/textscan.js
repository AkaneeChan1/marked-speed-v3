// A hand-written replacement for marked's inline `text` rule.
//
// The rule is
//   ^(?:[^a-zA-Z0-9](?=(?:mailto|xmpp):)
//     |(`+|~+|[^`~])(?:(?=[`~])|(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)
//                    |[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|[hH][tT][tT][pP][sS]?|[fF][tT][pP]:\/\/
//                                |(?<![^\s*_~(])www\.|$)
//                              |[^ ](?= {2,}\n)
//                              |[^a-zA-Z0-9](?=(?:mailto|xmpp):)
//                              |[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@))))
//
// scanText(src) returns the length of that match. The rule always matches a non-empty
// string, so the result is in 1..src.length (0 only for an empty input).
//
// The scan is one forward pass. A 128-entry table classifies each ASCII code unit and an
// ordinary letter or digit carries no bits, so the inner loop is a load, a test and an
// increment. A stop alternative is only evaluated at a character that can start it: a
// marker, an autolink prefix, the first space of a run, or the punctuation that could
// precede mailto:/xmpp: or an e-mail address.

const SPACE = 32;
const TAB = 9;
const NEWLINE = 10;
const BACKTICK = 96;
const TILDE = 126;
const AT = 64;
const COLON = 58;

const STOP = 1; // \ < ! [ ` * ~ _ : the run ends before this character
const HTTP = 2; // h H
const FTP = 4; // f F
const WWW = 8; // w W
const SP = 16; // space: a hard line break may start here
const OTHER = 32; // not [a-zA-Z0-9]: mailto:/xmpp: or an e-mail address may start here

const CHAR = new Uint8Array(128);
for (const c of [92, 60, 33, 91, 96, 42, 126, 95]) CHAR[c] |= STOP;
for (const c of [104, 72]) CHAR[c] |= HTTP;
for (const c of [102, 70]) CHAR[c] |= FTP;
for (const c of [119, 87]) CHAR[c] |= WWW;
for (let c = 0; c < 128; c++) {
  const alnum = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
  if (!alnum) CHAR[c] |= OTHER;
}
CHAR[SPACE] |= SP;

/** [a-zA-Z0-9.!#$%&'*+/=?_`{|}~-], the local part of an e-mail address. */
const EMAIL = new Uint8Array(128);
for (let c = 48; c <= 57; c++) EMAIL[c] = 1;
for (let c = 65; c <= 90; c++) EMAIL[c] = 1;
for (let c = 97; c <= 122; c++) EMAIL[c] = 1;
for (const c of [46, 33, 35, 36, 37, 38, 39, 42, 43, 47, 61, 63, 95, 96, 123, 124, 125, 126, 45]) EMAIL[c] = 1;

function isAlnum(c) {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

/** 2 or more spaces immediately followed by a newline, starting at q. */
function twoSpacesNewline(src, q) {
  const n = src.length;
  if (q + 2 >= n) return false;
  let i = q;
  while (i < n && src.charCodeAt(i) === SPACE) i++;
  return i - q >= 2 && i < n && src.charCodeAt(i) === NEWLINE;
}

/** `mailto:` or `xmpp:` starting at q. */
function protocolAt(src, q) {
  const n = src.length;
  const c = src.charCodeAt(q);
  if (c === 109) {
    if (q + 7 > n) return false;
    return (
      src.charCodeAt(q + 1) === 97 &&
      src.charCodeAt(q + 2) === 105 &&
      src.charCodeAt(q + 3) === 108 &&
      src.charCodeAt(q + 4) === 116 &&
      src.charCodeAt(q + 5) === 111 &&
      src.charCodeAt(q + 6) === COLON
    );
  }
  if (c === 120) {
    if (q + 5 > n) return false;
    return src.charCodeAt(q + 1) === 109 && src.charCodeAt(q + 2) === 112 && src.charCodeAt(q + 3) === 112 && src.charCodeAt(q + 4) === COLON;
  }
  return false;
}

/** `[email chars]+@` starting at q (q must itself be an e-mail character). */
function emailRunAt(src, q) {
  const n = src.length;
  let i = q;
  while (i < n) {
    const c = src.charCodeAt(i);
    if (c < 128 && EMAIL[c] === 1) i++;
    else break;
  }
  return i > q && i < n && src.charCodeAt(i) === AT;
}

/** `[hH][tT][tT][pP][sS]?` at p. */
function httpAt(src, p) {
  if (p + 4 > src.length) return false;
  const a = src.charCodeAt(p);
  const b = src.charCodeAt(p + 1);
  const c = src.charCodeAt(p + 2);
  const d = src.charCodeAt(p + 3);
  return (a === 104 || a === 72) && (b === 116 || b === 84) && (c === 116 || c === 84) && (d === 112 || d === 80);
}

/** `[fF][tT][pP]:\/\/` at p. */
function ftpAt(src, p) {
  if (p + 6 > src.length) return false;
  const a = src.charCodeAt(p);
  const b = src.charCodeAt(p + 1);
  const c = src.charCodeAt(p + 2);
  return (
    (a === 102 || a === 70) &&
    (b === 116 || b === 84) &&
    (c === 112 || c === 80) &&
    src.charCodeAt(p + 3) === COLON &&
    src.charCodeAt(p + 4) === 47 &&
    src.charCodeAt(p + 5) === 47
  );
}

/** `(?<![^\s*_~(])www\.` at p: "www." at the start of a string or after whitespace/`*_~(`. */
function wwwAt(src, p) {
  if (p + 4 > src.length) return false;
  if (src.charCodeAt(p) !== 119 || src.charCodeAt(p + 1) !== 119 || src.charCodeAt(p + 2) !== 119) return false;
  if (src.charCodeAt(p + 3) !== 46) return false;
  if (p === 0) return true;
  const c = src.charCodeAt(p - 1);
  return c === SPACE || c === TAB || c === NEWLINE || c === 13 || c === 12 || c === 42 || c === 95 || c === 126 || c === 40;
}

export function scanText(src) {
  const n = src.length;
  if (n === 0) return 0;

  const c0 = src.charCodeAt(0);
  // Alternative A: one non-alphanumeric character right before mailto: or xmpp:.
  if (!isAlnum(c0) && protocolAt(src, 1)) return 1;

  // Alternative B: a run of backticks or tildes, or a single other character.
  let i = 1;
  if (c0 === BACKTICK || c0 === TILDE) {
    while (i < n && src.charCodeAt(i) === c0) i++;
  }

  // The group that has to follow that first character.
  if (i >= n) return n;
  const ci = src.charCodeAt(i);
  if (ci === BACKTICK || ci === TILDE) return i;
  if (ci === SPACE && twoSpacesNewline(src, i)) return i;
  if (ci < 128 && EMAIL[ci] === 1 && emailRunAt(src, i)) return i;

  let p = i;
  while (p < n) {
    const c = src.charCodeAt(p);
    const t = c < 128 ? CHAR[c] : OTHER;
    if (t === 0) {
      p++;
      continue;
    }
    if ((t & STOP) !== 0) return p;
    if ((t & HTTP) !== 0) {
      const d = src.charCodeAt(p + 1);
      if ((d === 116 || d === 84) && httpAt(src, p)) return p;
    } else if ((t & FTP) !== 0) {
      const d = src.charCodeAt(p + 1);
      if ((d === 116 || d === 84) && ftpAt(src, p)) return p;
    } else if ((t & WWW) !== 0) {
      if (src.charCodeAt(p + 1) === 119 && wwwAt(src, p)) return p;
    }
    // A hard line break: the run ends just before this run of spaces. Checking at the
    // first space of the run gives the same length as the rule's [^ ](?= {2,}\n), which
    // stops after the last non-space character.
    if ((t & SP) !== 0 && p + 1 < n && src.charCodeAt(p + 1) === SPACE && twoSpacesNewline(src, p)) return p;
    if ((t & OTHER) !== 0) {
      const d = src.charCodeAt(p + 1);
      if ((d === 109 || d === 120) && protocolAt(src, p + 1)) return p + 1;
      if (d < 128 && EMAIL[d] === 1 && emailRunAt(src, p + 1)) return p + 1;
    }
    p++;
  }
  return n;
}
