# Changelog

## 0.2.0 — 2026-10-18

- The initiator MAY open with terms: an `offer` is allowed in a `draft`, so
  the invitation carries it. It takes the round to 1 and leaves the turn with
  nobody until the peer joins (SPEC.md §5).
- A `draft` MAY be cancelled by the initiator. Before, no move was allowed
  until the peer joined.
- New `afterJoin(room, {initiator, peer})`: on join, the turn is the peer's if
  terms are on the table, and the initiator's if not.
- A relay now stores a draft's turn as the initiator, not null.
- `vectors/moves.json`: cases may start from a draft, and a step may be a join.

## 0.1.1 — 2026-10-17

No changes to the protocol or the code. The first release published from CI
through npm trusted publishing, with provenance.

## 0.1.0 — 2026-10-16

First public draft: envelope, subject schemas, state machine, deadlines,
private limits, circling, MCP binding, test vectors and JSON Schemas.
