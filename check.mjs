// Practice checker: render every case with parse() and compare with the kit's expected
// HTML, code unit for code unit. Prints passed/total and, for the first mismatch, the
// character where the two diverge.
//
//   node check.mjs              # all 720 cases
//   node check.mjs 0 100        # a slice, for quick iteration
//
// Exit code 0 when every case in the slice matches.

import { readFileSync } from 'node:fs';
import { parse } from './parse.js';

const KIT = '/home/ubuntu/.hermes/profiles/bot3/cache/scratch/makefun/md2/markdown-render-speed-02-kit';
const cases = JSON.parse(readFileSync(`${KIT}/practice/input/cases.json`, 'utf8'));
const expected = JSON.parse(readFileSync(`${KIT}/practice/reference/expected.json`, 'utf8'));
const want = new Map(expected.cases.map((c) => [c.id, c.html]));

const from = Number(process.argv[2] ?? 0);
const to = Number(process.argv[3] ?? cases.length);
const slice = cases.slice(from, to);

let passed = 0;
let firstBad = null;
const failures = [];
for (const c of slice) {
  const got = parse(c.markdown);
  const exp = want.get(c.id);
  if (got === exp) passed++;
  else {
    failures.push(c.id);
    if (firstBad === null) {
      let at = 0;
      const n = Math.min(got.length, exp.length);
      while (at < n && got.charCodeAt(at) === exp.charCodeAt(at)) at++;
      const ctx = (s) => JSON.stringify(s.slice(Math.max(0, at - 40), at + 60));
      firstBad = { id: c.id, at, got: ctx(got), exp: ctx(exp), glen: got.length, elen: exp.length };
    }
  }
}

console.log(`${passed}/${slice.length} cases ${from}..${to - 1}`);
if (firstBad) {
  console.log(`first mismatch ${firstBad.id} at char ${firstBad.at} (got ${firstBad.glen}, want ${firstBad.elen})`);
  console.log(`  got  ${firstBad.got}`);
  console.log(`  want ${firstBad.exp}`);
  if (failures.length > 1) console.log(`failures: ${failures.slice(0, 20).join(' ')}${failures.length > 20 ? ' …' : ''}`);
}

process.exitCode = passed === slice.length ? 0 : 1;
