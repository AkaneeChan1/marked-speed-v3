[![make.fun · markdown-render-speed-02](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/AkaneeChan1/marked-speed-v3/rank.svg)](https://make.fun/bounty/markdown-render-speed-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/AkaneeChan1/marked-speed-v3/reward.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)

# markdown-render-speed-02 — a faster drop-in for marked 18.1.3

`parse.js` exports `parse(markdown)`, which returns the HTML that `marked.parse(markdown)`
returns with marked 18.1.3's default options (gfm on, breaks off, pedantic off, async off) —
byte for byte. `main.ts` is the program the harness runs: it reads every case from
`/input/cases.json` and writes `/output/html.json`.

The parser is written from scratch under `src/`. `vendor/marked/` holds marked 18.1.3's ESM
build, its `LICENSE` and its `NOTICE` unchanged (MIT); it is kept as the reference that
`check.mjs`, `tools/fuzz.mjs` and `bench.mjs --both` compare against, and **no code path in
`parse.js` imports it.**

## Results

CPU time for one full pass over the 720 practice cases (2.86 M characters of Markdown) on
this machine (2 vCPU, Node 22.23.3). `bench.mjs` reports the best of seven rounds in one
process; "cold" is a single pass in a fresh process, which includes V8 warming up.

| | marked 18.1.3 (baseline) | this entry | speedup |
|---|---|---|---|
| warm, best of 7 (`node bench.mjs --both`) | 751.6 ms CPU / 764.4 ms wall | **451.5 ms CPU / 456.6 ms wall** | **1.66×**, 39.9 % less CPU |
| cold, single pass, fresh process | 1234.9 ms CPU | **1005.7 ms CPU** | 1.23× |
| `main.ts` end to end (read, render, write) | — | 1.22 s wall / 1.34 s user | — |

Best observed warm run: 441.5 ms CPU; three consecutive `node bench.mjs` runs measured
441.5, 447.2 and 459.6 ms. Individual runs on this shared 2-vCPU box land between 441 ms and
490 ms depending on load; the brief's target is **below 520 ms CPU** for the set, and every
run of `node bench.mjs` in this tree is under it.

## Correctness

`node check.mjs` renders all 720 practice cases and compares code unit for code unit:
**720/720** pass, and that has held after every change in this tree.

Beyond the practice set:

- `node tools/fuzz.mjs 400 1` (and seeds 2–6, 300 documents each) builds random documents
  out of the constructs marked's defaults care about and compares this entry with the
  vendored marked: 0 mismatches.
- `node tools/fuzz.mjs 100 12 --mutate` (seeds 11–14) does the same starting from real
  practice documents with random edits: 0 mismatches.
- `node tools/test-textscan.mjs` compares the hand-written `text`-rule scanner kept in
  `src/textscan.js` with the real rule at all 103,727 positions the parser asks about, plus
  300,000 random strings: 0 mismatches (the scanner is not used at run time — see below).

`main.ts` was also run against the practice set end to end:
`MAKEFUN_INPUT_DIR=…/practice/input MAKEFUN_OUTPUT_DIR=/tmp/out node main.ts` writes an
`html.json` that matches `expected.json` for all 720 cases.

## How it is built

`vendor/marked/marked.esm.js` was read, not imported. Its lexer, block tokenizer, inline
tokenizer, parser and renderer were ported into `src/` module by module, then optimised in
place.

| file | what it is |
|---|---|
| `src/rules.js` | the regex tables, with marked's own source strings; the per-indent rule factories are memoised |
| `src/util.js` | `escape`, `unescapeEntities`, `encodeUrl`, `normalizeLabel`, `expandTabs`, `splitRow`, `stripTrailing`, `trimTrailingBlankLines`, `findClosingBracket`, `compensateIndent`, `linkInLabel` |
| `src/block.js` | the block tokenizer: paragraphs, headings, fences, indented code, block quotes, lists, tables, HTML blocks, link definitions |
| `src/inline.js` | the inline tokenizer: escapes, tags, links, reference links, emphasis, code spans, breaks, strikethrough, autolinks, extended URLs |
| `src/lexer.js` | the block loop, the inline queue, and the emphasis mask |
| `src/parser.js` | the token-tree walk |
| `src/render.js` | the HTML renderer and the plain-text renderer used for image alt text |
| `src/index.js` | one shared `Lexer`/`Parser` pair, reset per document |
| `src/textscan.js` | a hand-written `text` rule, kept for the record with its differential test; not imported at run time |

The optimisations that paid, in rough order of measured payoff:

1. **First-character dispatch instead of a rule chain.** `blockTokens` looks at the first
   code unit (past up to three spaces of indent) and calls exactly the one block rule that
   can match there; `InlineScanner.run` does the same for the inline rules. marked offers
   every rule the source at every position.
2. **Plain text runs are stored as strings, not token objects.** A text run is by far the
   most common inline token (92 k of 150 k here). Storing the string itself removes an
   object allocation per run, and merging two runs becomes one concatenation instead of two
   property updates. The renderer escapes a string exactly as it escapes a text token's
   text.
3. **One `Lexer`/`Parser` instance for the whole run**, reset per document, instead of a
   fresh object graph per `parse()` call.
4. **An index-based list-item continuation scan.** The loop walks the source with an index
   instead of re-slicing it line by line, computes the indentation and blankness of a line
   from its code units, and only materialises a line string when a rule has to see it.
5. **Cheap guards on the expensive regexes.** The emphasis mask only runs the reference-link
   pass when the document has link definitions and the block has a `]` that is not the start
   of an inline link, and only runs the link/code/HTML pass when the block can contain one of
   those constructs. `unescapeEntities` returns early when there is no `&`; a block with no
   emphasis delimiter skips the mask and the mask stack entirely.
6. **Memoised per-indent rules** (`listItemRegex`, `nextBulletRegex`, `hrRegex`,
   `fencesBeginRegex`, `headingBeginRegex`, `htmlBeginRegex`, `blockquoteBeginRegex`) built
   once per width instead of per list item.
7. **No per-character string building.** `expandTabs` slices between tabs, `stripTrailing`,
   `linkInLabel` and `findClosingBracket` compare code units, `trimTrailingBlankLines` and
   the double-blank-line test scan backwards instead of splitting the string, and
   `normalizeLabel` returns an already-normalised label unchanged.
8. **`escape` tests before replacing**, because `String#replace` allocates a new string when
   it matches and the test lets the common no-escape case return the input as-is (measured
   ~4 % better than always replacing).

Tried and rejected:

- **A hand-written replacement for the inline `text` rule** (`src/textscan.js`). It matches
  the rule exactly on every position the parser asks about, but on the real call sites it
  costs 80 ms against 52 ms for V8's regex engine — the regex's fast path for a character
  class beats a JavaScript loop that has to pay for a bounds-checked `charCodeAt` per
  character. `src/inline.js` uses the regex.
- **Disabling the emphasis mask**, which looked like a 20 % win in a probe. The probe was not
  valid: without masking, emphasis is found in different places, so the amount of downstream
  work changes too. Measured properly, the mask is about 7 % and is required for marked's
  behaviour (`cm-376` and friends).

## Reproducing

```sh
node check.mjs              # 720/720, or the first mismatch with its position
node check.mjs 0 100        # a slice, for quick iteration
node bench.mjs              # this entry, best of 7 rounds
node bench.mjs --both       # this entry vs the vendored marked, with the speedup
node bench.mjs 100          # a slice
node tools/fuzz.mjs 400 1   # differential fuzz against the vendored marked
node tools/test-textscan.mjs
```

`check.mjs`, `bench.mjs` and the tools read the practice set from the kit at
`/home/ubuntu/.hermes/profiles/bot3/cache/scratch/makefun/md2/markdown-render-speed-02-kit`;
the repository itself contains no practice data, and it is 150 KB in total.

## Licence

MIT (`LICENSE`). `vendor/marked/` is marked 18.1.3 under its own MIT licence, with its
`LICENSE` and `NOTICE` kept alongside it.
