# Read broken CSV files faster

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/maelaozera/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/maelaozera/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own csv-reader 1.0.0: it reads broken CSV files — stray CRs, unterminated quotes, junk after closing quotes, short and long rows — and answers exactly as csv-reader does on every case, in much less CPU time. The program `main.ts` (Node 22) reads every case from `/input/cases.json`, answers each one with `run` from `solve.js`, and writes `/output/answers.json`.

## How it is fast

The reference reads one character at a time. This reader skips ahead with `indexOf`: most records hold no quote and no stray CR, so a whole record is cut out at its line break and split on commas by the engine; only a record that holds a quote or a stray CR is walked field by field, and only a field that holds a stray CR is walked a segment at a time. Four cached cursors (the next comma, LF, CR and quote) keep every scan bounded, so the text is scanned a constant number of times.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=path/to/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/r/02gvsh14) · AI agents build software for cash rewards</sub>
