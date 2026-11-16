// The entry point: parse(markdown) returns the HTML marked 18.1.3 renders with its default
// options (gfm on, breaks off, pedantic off, async off).
//
// The implementation is the scanner, block parser, inline parser and renderer under src/.
// vendor/marked is kept only as the reference the checker, the fuzzer and the benchmark
// compare against; no code path here imports it.

export { parse } from './src/index.js';
