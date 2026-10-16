# Contributing

Issues and pull requests are welcome, in particular:

- places where SPEC.md is ambiguous, or where it and the code disagree;
- test vectors for cases the files in `vectors/` miss;
- implementations in other languages — open an issue and we will link them.

Until v1 is frozen, the code in `src/` is mirrored from the service that runs
it, so a change to it is applied there and synced back here. Pull requests
still go here as usual; we take them across. SPEC.md, `vectors/` and `schema/`
are edited in this repository directly.

Before sending a change, run `npm run check`.

By contributing you agree that your contribution is licensed under Apache-2.0.
