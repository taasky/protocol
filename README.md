# Taasky Negotiation Protocol

An open protocol for two sides to settle terms through their agents: a window
for the plumber, a swapped shift, a moved lesson. A side can also be a person
answering in a browser. The humans confirm at the end. Each side declares
the shape of its terms; every move is validated against it; agreement is two
approvals of the same hash; and an agent cannot approve on its own.

- **[SPEC.md](SPEC.md)**: the protocol.
- **[src/](src)**: the reference implementation in TypeScript. Pure functions,
  no dependencies, no storage.
- **[vectors/](vectors)**: language-neutral test vectors. An implementation
  that passes them is conformant.
- **[schema/](schema)**: JSON Schemas for the envelope, a subject declaration
  and private limits.

Status: **v1 draft.** Incompatible changes may still land before v1 is frozen;
each is listed in [CHANGELOG.md](CHANGELOG.md).

## What it guarantees

- **The human confirms the terms, not the agent's retelling of them.** The
  confirmation card is rendered from typed fields the other side declared.
- **Approval is not an action an agent can take.** `approve`, `reject` and
  `cancel` wait for the human.
- **"We agreed" is checkable.** Both sides approve the SHA-256 of the same
  canonical terms.
- **A deal outside your limits needs you to say so.** Private bounds are seen
  only by the relay; an agent cannot offer past them, the card flags terms
  beyond them, and when both sides' bounds cannot meet, both hear so without
  either number.
- **Rooms end.** Deadlines, expiry, and a signal when two agents go in circles.

## Use it

Try it with an agent: add `https://mcp.taasky.ai/mcp` as a remote MCP server
(no account needed) and ask your agent to book a time with someone: the
plumber, a tutor, a friend for coffee.

Or use the reference implementation in your own relay:

```ts
import { parseSchema, planMove } from "@taasky/protocol";

const schema = parseSchema({
  slot: { type: "timerange", label: "Meeting time" },
  duration_min: { type: "int", label: "Duration, minutes" },
});

const plan = await planMove(
  { id: "rm_1", state: "awaiting", round: 0, turn: "a", deadline: null },
  [{ id: "a", subject_schema: schema }, { id: "b", subject_schema: schema }],
  [],
  {
    actor: "a",
    verdict: "offer",
    subject: {
      slot: { start: "2026-10-14T10:00:00Z", end: "2026-10-14T10:30:00Z" },
      duration_min: 30,
    },
  },
  new Date(),
);
// plan.message: what to record; plan.next: the room after the move.
```

`planMove` decides and never writes: store the move only if the room has not
changed since you loaded it.

## Develop

```sh
npm install
npm run check   # lint, typecheck, tests and vectors
```

Node 20 or later.

## License

[Apache-2.0](LICENSE).
