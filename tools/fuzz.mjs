// Differential fuzz: build random Markdown documents, render them with this implementation
// and with the vendored marked 18.1.3, and compare the two byte for byte.
//
//   node tools/fuzz.mjs [docs] [seed]
//
// The generator mixes the constructs marked's default configuration cares about (headings,
// emphasis, links, code, lists, tables, block quotes, raw HTML, entities, escapes, CRLF and
// tabs) into documents of random shape, so a mismatch points at a rule interaction the
// practice set does not cover.

import { readFileSync } from 'node:fs';
import { parse } from '../parse.js';
import { marked } from '../vendor/marked/marked.esm.js';

const docs = Number(process.argv[2] ?? 300);
let seed = Number(process.argv[3] ?? 1);

const KIT = '/home/ubuntu/.hermes/profiles/bot3/cache/scratch/makefun/md2/markdown-render-speed-02-kit';
const cases = JSON.parse(readFileSync(`${KIT}/practice/input/cases.json`, 'utf8'));

function rnd() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (n) => Math.floor(rnd() * n);

const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'word', 'text', 'foo', 'bar', 'baz', 'x', 'readme', 'note', 'item'];
const INLINE = [
  (w) => w,
  (w) => `*${w}*`,
  (w) => `**${w}**`,
  (w) => `_${w}_`,
  (w) => `__${w}__`,
  (w) => `~~${w}~~`,
  (w) => `\`${w}\``,
  (w) => `\`\`${w} \` x\`\``,
  (w) => `[${w}](https://example.com/${w})`,
  (w) => `[${w}](<https://example.com/a b> "t")`,
  (w) => `![${w}](/img/${w}.png)`,
  (w) => `[${w}][ref]`,
  (w) => `<https://example.com/${w}>`,
  (w) => `<a href="/x">${w}</a>`,
  (w) => `&amp; ${w} &copy; &#35; &#x41;`,
  (w) => `\\*${w}\\*`,
  (w) => `${w}_${w}`,
  (w) => `**${w} *${w}***`,
  (w) => `${w}  `,
  (w) => `${w}\\\n`,
  (w) => `www.example.com/${w}`,
  (w) => `user.${w}@example.com`,
  (w) => `mailto:${w}@example.com`,
  (w) => `<span>${w}</span>`,
  (w) => `<!-- ${w} -->`,
];
const BLOCKS = [
  () => `# ${phrase()}`,
  () => `## ${phrase()} ##`,
  () => `${phrase()}\n${pick(['===', '---', '====  ', '---------'])}`,
  () => `${phrase()}\n${phrase()}`,
  () => `> ${phrase()}\n> ${phrase()}`,
  () => `> ${phrase()}\n>\n> - ${phrase()}\n> - ${phrase()}`,
  () => `- ${phrase()}\n- ${phrase()}\n  - ${phrase()}`,
  () => `1. ${phrase()}\n2. ${phrase()}\n\n${phrase()}`,
  () => `- [ ] ${phrase()}\n- [x] ${phrase()}`,
  () => `${'*'} ${phrase()}\n\n${'*'} ${phrase()}`,
  () => '```js\nconst a = 1;\n  const b = "*x*";\n```',
  () => '~~~\nplain <b> &amp;\n~~~',
  () => `    indented code\n    more *code*`,
  () => '| a | b |\n| :- | -: |\n| 1 | 2 |\n| *x* | `y` |',
  () => '<div>\nraw *html*\n</div>',
  () => '<details>\n<summary>t</summary>\n\n' + phrase() + '\n\n</details>',
  () => '***',
  () => '---',
  () => `[ref]: https://example.com/ref "Title"`,
  () => `[ref]: <https://example.com/x>`,
  () => phrase(),
  () => `${phrase()}\n${phrase()}\n${phrase()}`,
  () => `text with a tab\there and ${phrase()}`,
];

function word() {
  return pick(WORDS);
}
function phrase() {
  const n = 1 + int(6);
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(pick(INLINE)(word()));
  return parts.join(' ');
}

// Mutation mode: start from a real practice document and make a few random edits, so the
// fuzz also covers the input distribution the competition actually draws from.
const CHARS = ' \t\n*_~`[]()!<>#|-\\.:/&;\'"\u00e9\u4e2d';
function mutate(src) {
  let s = src;
  const edits = 1 + int(4);
  for (let e = 0; e < edits; e++) {
    const at = int(s.length + 1);
    const kind = int(3);
    if (kind === 0) s = s.slice(0, at) + pick([...CHARS]) + s.slice(at);
    else if (kind === 1) s = s.slice(0, at) + s.slice(at + 1 + int(3));
    else s = s.slice(0, at) + s.slice(at, at + 1 + int(20)) + s.slice(at);
  }
  return s;
}
const mutateMode = process.argv.includes('--mutate');

let mismatches = 0;
for (let d = 0; d < docs; d++) {
  let doc;
  if (mutateMode) {
    doc = mutate(pick(cases).markdown);
  } else {
    doc = '';
    const n = 1 + int(8);
    for (let i = 0; i < n; i++) {
      doc += pick(BLOCKS)() + '\n\n';
    }
    if (rnd() < 0.15) doc = doc.replace(/\n/g, '\r\n');
    if (rnd() < 0.1) doc += '\n';
    if (rnd() < 0.1) doc = doc.replace(/^( +)/gm, '\t');
  }

  const want = marked.parse(doc);
  const got = parse(doc);
  if (got !== want) {
    mismatches++;
    let at = 0;
    while (at < Math.min(got.length, want.length) && got[at] === want[at]) at++;
    console.log(`MISMATCH doc ${d} at ${at}`);
    console.log('  input:', JSON.stringify(doc.slice(0, 400)));
    console.log('  got  :', JSON.stringify(got.slice(Math.max(0, at - 60), at + 80)));
    console.log('  want :', JSON.stringify(want.slice(Math.max(0, at - 60), at + 80)));
    if (mismatches >= 3) process.exit(1);
  }
}
console.log(`${docs} documents, ${mismatches} mismatches (seed ${process.argv[3] ?? 1})`);
process.exitCode = mismatches === 0 ? 0 : 1;
