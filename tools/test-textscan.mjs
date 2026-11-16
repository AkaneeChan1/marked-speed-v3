// Differential test: scanText() must return exactly the length the real inline `text` rule
// matches, at every position the real parser asks about and on random strings.
//
//   node tools/test-textscan.mjs           # every text-rule call site in the practice set
//   node tools/test-textscan.mjs fuzz      # random strings only
//
// The call sites are collected by wrapping the rule during one real parse, so the test sees
// exactly the strings the parser hands to it (92k of them, 1.6M characters).

import { readFileSync } from 'node:fs';
import { scanText } from '../src/textscan.js';
import { inline } from '../src/rules.js';
import { parse } from '../parse.js';

const KIT = '/home/ubuntu/.hermes/profiles/bot3/cache/scratch/makefun/md2/markdown-render-speed-02-kit';
const cases = JSON.parse(readFileSync(`${KIT}/practice/input/cases.json`, 'utf8'));

function check(src) {
  const m = inline.text.exec(src);
  const want = m === null ? 0 : m[0].length;
  const got = scanText(src);
  if (got === want) return true;
  console.log(`MISMATCH wanted ${want} got ${got}`);
  console.log('  src:', JSON.stringify(src.slice(0, 200)));
  console.log('  ok :', JSON.stringify(src.slice(0, want)));
  console.log('  bad:', JSON.stringify(src.slice(0, got)));
  return false;
}

let checked = 0;

if (process.argv.includes('fuzz')) {
  const alpha = ['a', 'Z', '0', '_', '*', '~', '`', '\\', '<', '>', '!', '[', ']', '(', ')', ' ', '  ', '\n', '\t', ':', '@', '.', '/', '-', 'h', 't', 'p', 'f', 'w', 'm', 'x', 'mailto:', 'xmpp:', 'http://', 'www.', '&amp;', '\u00e9', '\u4e2d'];
  let seed = 987654321;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let k = 0; k < 300000; k++) {
    let s = '';
    const len = 1 + Math.floor(rnd() * 14);
    for (let j = 0; j < len; j++) s += alpha[Math.floor(rnd() * alpha.length)];
    checked++;
    if (!check(s)) process.exit(1);
  }
} else {
  // Collect every string the parser passes to the text rule.
  const real = inline.text;
  const sites = [];
  inline.text = {
    exec(src) {
      sites.push(src);
      return real.exec(src);
    },
  };
  try {
    for (const c of cases) parse(c.markdown);
  } finally {
    inline.text = real;
  }
  console.log(`collected ${sites.length} call sites`);
  for (const s of sites) {
    checked++;
    if (!check(s)) process.exit(1);
  }
}
console.log(`ok, ${checked} comparisons`);
