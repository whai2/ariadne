# BFCL V4 mini dataset notice

`src/datasets/bfcl.ts` contains a modified 12-case excerpt from the Berkeley Function Calling
Leaderboard (BFCL) data at commit `6ea57973c7a6097fd7c5915698c54c17c5b1b6c8`:

- `bfcl_eval/data/BFCL_v4_simple_javascript.json`
- `bfcl_eval/data/possible_answer/BFCL_v4_simple_javascript.json`
- `bfcl_eval/data/BFCL_v4_irrelevance.json`

Changes: BFCL type names were normalized to JSON Schema, descriptions were shortened, and the first
user turn was flattened into Ariadne's dataset shape. The source project is
<https://github.com/ShishirPatil/gorilla> and is distributed under the Apache License 2.0. The
unaltered license text is included in `LICENSE-BFCL`.

Copyright 2024 The Gorilla Team
