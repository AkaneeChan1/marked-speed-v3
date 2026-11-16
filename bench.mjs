// CPU benchmark for the parse loop over the practice set.
//
//   node bench.mjs                # warm, best of 7 rounds, all cases
//   node bench.mjs 100            # warm, best of 7 rounds, first 100 cases
//   node bench.mjs --both         # ours and the vendored marked, back to back, all cases
//   node bench.mjs --both 100     # the same on a slice
//
// The timed loop is exactly what main.ts does: for each case, parse(markdown). Reading the
// input and the reference happens outside the timed region. CPU time (process.cpuUsage) is
// used rather than wall time so other load on the machine does not move the number.

import { readFileSync } from 'node:fs';

const KIT = '/home/ubuntu/.hermes/profiles/bot3/cache/scratch/makefun/md2/markdown-render-speed-02-kit';
const cases = JSON.parse(readFileSync(`${KIT}/practice/input/cases.json`, 'utf8'));
const limit = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? cases.length);
const markdowns = cases.slice(0, limit).map((c) => c.markdown);
const ROUNDS = 7;

const ours = (await import('./parse.js')).parse;
const marked = process.argv.includes('--both') ? (await import('./vendor/marked/marked.esm.js')).marked.parse : null;

function measure(fn) {
  for (let i = 0; i < markdowns.length; i++) fn(markdowns[i]); // warm-up
  let bestCpu = Infinity;
  let bestWall = Infinity;
  for (let r = 0; r < ROUNDS; r++) {
    const c0 = process.cpuUsage();
    const w0 = process.hrtime.bigint();
    for (let i = 0; i < markdowns.length; i++) fn(markdowns[i]);
    const wall = Number(process.hrtime.bigint() - w0) / 1e6;
    const d = process.cpuUsage(c0);
    const cpu = (d.user + d.system) / 1000;
    if (cpu < bestCpu) bestCpu = cpu;
    if (wall < bestWall) bestWall = wall;
  }
  return { cpu: bestCpu, wall: bestWall };
}

const a = measure(ours);
console.log(`ours   cpu ${a.cpu.toFixed(1)} ms   wall ${a.wall.toFixed(1)} ms   (best of ${ROUNDS}, ${markdowns.length} cases)`);
if (marked) {
  const b = measure(marked);
  console.log(`marked cpu ${b.cpu.toFixed(1)} ms   wall ${b.wall.toFixed(1)} ms   (best of ${ROUNDS}, ${markdowns.length} cases)`);
  console.log(`speedup ${(b.cpu / a.cpu).toFixed(2)}x  (${(100 * (1 - a.cpu / b.cpu)).toFixed(1)}% less CPU)`);
}
