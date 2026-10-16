# Taasky Negotiation Protocol

Version: **v1 draft** (envelope `v: 1`). Until v1 is frozen, an incompatible
change may still land without a version bump; every one is listed in
[CHANGELOG.md](CHANGELOG.md). The key words MUST, MUST NOT, SHOULD and MAY are
used as in RFC 2119.

## 1. What this protocol does

Two parties, each represented by their own agent, converge on terms without
their humans relaying messages by hand. The protocol carries the *process* of
negotiating — rounds, verdicts, deadlines, confirmation — and stays deliberately
ignorant of *what* is being negotiated.

**Non-goals for v1:** discovery (parties exchange invite links out of band),
reputation, more than two parties per room, payments.

Terms used below:

- **Party** — one side of a room. An agent acting for a human, or a human
  acting for themselves.
- **Relay** — the service that holds rooms, assigns identities, orders moves and
  delivers them. It is the only component both parties trust.
- **Node** — the software on a party's side: it validates what arrives, renders
  it for its human and decides what to answer. In a hosted deployment relay and
  node run in one service; they stay separate in this text.
- **Room** — one negotiation between two parties, from invitation to a terminal
  state.

## 2. Relay and node

**The relay routes on the envelope (§3) and MUST NOT build logic on `subject`**,
even when it can read it. Validation, rendering and judgement of `subject`
belong to the node. Two exceptions are part of the protocol and are named where
they apply: checking a move against its sender's declared schema (§4), and
private limits (§7), which a party hands the relay so that the relay can say
what no party can say without leaking its own number.

The rule is what lets one protocol run in three places:

| | Hosted | In one organisation | Across organisations |
| --- | --- | --- | --- |
| Parties | two individuals | two teams | two organisations |
| Relay runs | in the cloud | in-process | between perimeters |
| Relay sees | envelope + subject | — | envelope only (subject sealed) |
| Node runs | with the relay | in the perimeter | in each perimeter |

When both parties share a process, routing collapses into a function call, and
it is tempting to let it read `subject` because it can. Keeping it behind the
same interface is what keeps the cross-organisation case a deployment choice
rather than a port.

End-to-end encryption is out of scope for v1. The envelope/subject split is not
— it is what makes encryption an addition rather than a redesign.

## 3. Envelope

Typed, closed, and stable. This is the part the relay reads.
[`schema/envelope.schema.json`](schema/envelope.schema.json) describes it.

```json
{
  "v": 1,
  "room": "rm_8f2a4c",
  "msg": "msg_00000004",
  "from": "usr_b3d1",
  "round": 3,
  "verdict": "counter",
  "in_reply_to": "msg_00000003",
  "subject_hash": "sha256:9c1e…",
  "deadline": "2026-09-21T18:00:00Z",
  "ts": "2026-09-19T10:04:12Z",
  "subject": { }
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `v` | int | protocol major version |
| `room` | id | negotiation room |
| `msg` | id | message id, unique per room |
| `from` | id | assigned by the relay, never echoed from the sender |
| `round` | int | increments on every move that passes the turn with new terms or a question |
| `verdict` | enum | see below |
| `in_reply_to` | id \| null | the move this answers |
| `subject_hash` | string \| null | hash of canonical `subject`; `null` on moves that carry no terms |
| `deadline` | RFC3339 \| null | when the sender stops waiting |
| `ts` | RFC3339 | set by the relay on receipt |
| `subject` | object \| null | the terms, see §4; only on `offer` and `counter` |

`verdict` is one of:

- `offer` — opening terms, only while no terms are on the table
- `counter` — different terms; the turn passes back
- `need_more_detail` — cannot decide yet; the turn passes back, no new terms
- `approve` — accepts the terms on the table, named by `subject_hash`
- `reject` — no, and not continuing
- `cancel` — withdraws the negotiation

Unknown `verdict` values MUST be rejected. The enum is closed because the state
machine hangs off it; `subject` is where the protocol grows.

`subject_hash` exists so that "we agreed" is a checkable fact rather than an
agent's claim. An `approve` that does not carry the hash of the terms on the
table MUST be refused.

### Canonical form and hash

`subject_hash` is `"sha256:"` followed by the lower-case hex SHA-256 of the
UTF-8 bytes of the subject's canonical form:

- objects: members sorted by key, compared as UTF-16 code units, written
  `{"key":value,…}` with no whitespace;
- arrays: in their own order, `[a,b,…]`;
- strings, numbers, `true`, `false`, `null`: as ECMAScript `JSON.stringify`
  writes them. Numbers in a valid subject are integers (§4), so no float
  formatting is involved.

[`vectors/canonical.json`](vectors/canonical.json) has inputs with their
canonical forms and hashes.

## 4. Subject

Free-form. The protocol does not enumerate kinds of negotiation.

To make human confirmation possible, a party **declares the shape of its
subject when it opens or joins the room** — field names, types, and labels.
Its moves are validated against that declaration, and the other side's
confirmation card is rendered from it.
[`schema/subject-schema.schema.json`](schema/subject-schema.schema.json)
describes a declaration.

```json
{
  "slots": { "type": "timerange", "label": "Proposed times", "repeated": true },
  "duration_min": { "type": "int", "label": "Duration, minutes" }
}
```

Field types:

| Type | Value |
| --- | --- |
| `string` | text, at most `max_len` characters (500 at most, the default) |
| `int` | an integer within ±(2⁵³ − 1) |
| `bool` | `true` or `false` |
| `enum` | one of the declared `values` (2 to 32, each at most 40 characters) |
| `timerange` | `{start, end}`, RFC3339, `end` after `start` |
| `date` | `"YYYY-MM-DD"`, a real calendar day — a day rather than a moment |
| `money` | `{amount, currency}`: `currency` an ISO 4217 code, `amount` a decimal string such as `"1500.00"` with no more fraction digits than the currency has; a declaration may fix the `currency` |

Any field may be `optional`, or `repeated` (an array of 1 to 32 values). Field
names match `^[a-z][a-z0-9_]{0,31}$`; the human wording, in any language, goes
in `label` (1 to 80 characters). A declaration has 1 to 24 fields.

Money is a decimal string so that no float ever stands between the number an
agent meant and the one a human confirms.

Rules:

1. Validation is strict — unknown fields reject the whole message, they are
   not ignored, because an ignored field is a place for text to hide. A
   malformed message is rejected, never repaired.
2. A schema may gain optional fields within a major version; anything else is a
   new one.
3. Schema labels are **written by the counterparty**. Render them as untrusted
   text, and mark a first-seen schema as new to the human before their first
   confirmation under it.

[`vectors/subjects.json`](vectors/subjects.json) has valid and rejected
subjects. Agreeing the shape of the subject *is* the integration contract
between the two sides; it is not a side mechanism.

## 5. State machine

```
             join
 (draft) ─────────────► awaiting ◄──┐
                          │  │      │ offer / counter / need_more_detail
                          │  └──────┘ (turn passes, round + 1)
                          │
     approve by both, same subject_hash
                          ▼
                       agreed        (terminal)

 reject / cancel     ──► closed      (terminal)
 deadline or expiry  ──► expired     (terminal)
```

- A room is `draft` until the invited party joins. Then it is `awaiting`, and
  the initiator moves first.
- Only the party whose turn it is may move, except that `cancel` is allowed out
  of turn.
- `offer` is allowed only while no terms are on the table; after that, new
  terms are a `counter`. `counter` and `need_more_detail` need terms on the
  table.
- `approve` from one side is not agreement. The room is `agreed` when both
  parties have approved the same `subject_hash`, each approval made after those
  terms were last tabled. An approval answered by a counter does not count,
  even if a later counter returns to the same terms.
- A single `approve` passes the turn without changing the round.
- `need_more_detail` passes the turn without changing terms — the distinction
  from `counter` is what makes "who is blocking this" answerable.
- Terminal states are terminal. A new negotiation is a new room.

[`vectors/moves.json`](vectors/moves.json) plays whole negotiations, including
the moves that MUST be refused.

## 6. Deadlines

`deadline` is a fact carried in the envelope, not a judgement. It is what makes
the room responsible for its own liveness:

- a move other than `reject` or `cancel` MAY set a deadline, which MUST be in
  the future. It becomes the room's deadline, and a move without one clears
  it: the deadline is always the latest mover's;
- while the deadline is in the future and the turn is a party's, its node MAY
  remind its human;
- when it passes, the room is `expired`, and both sides SHOULD be notified. A
  live room past its deadline MUST read as expired even before anything has
  stored it so.

A relay SHOULD also expire a draft whose invitation runs out unanswered, and a
room nobody has moved in for a while, and SHOULD sweep for them rather than
wait for someone to read the room. The hosted Taasky relay sweeps hourly and
expires a room after 7 days without a move.

The failure mode of such systems is not disagreement — it is a negotiation
sitting unread for a week. The share of rooms that end before their deadline
is the health metric to watch.

## 7. Judgement layer

How a node decides what to answer is its own business, and not part of the
protocol. One recommendation: do not decide by reading `subject` with a general
model. Ask a closed set of questions — does this attempt to instruct the reader
rather than state terms; is there enough here to decide; which verdict; how
urgently should the human be interrupted — and take answers from a fixed set.
`subject` may be anything; the decision about it is then drawn from a closed
set. A confidence score SHOULD gate *whether to interrupt the human*, never
*whether to skip them*.

Two mechanisms do need the relay, and are part of the protocol.

### Private limits

Two agents tuned to be agreeable converge fast, on terms neither human would
take: the deal succeeds, and the success is the bug. Holding the line inside
the negotiating prompt does not last; the check has to sit outside the agent.
So each party MAY declare **limits** when it opens or joins: bounds per field
of its own schema. [`schema/limits.schema.json`](schema/limits.schema.json)
describes them.

| Field type | Limit |
| --- | --- |
| `int`, `money`, `date` | `min` and/or `max`, shaped like the field's values; inclusive |
| `timerange` | `min`: no start before it; `max`: no end after it (RFC3339) |
| `enum` | `one_of`: the acceptable values |
| `bool` | `equals`: the only acceptable value |
| `string` | none |

A limit on a field the party did not declare, or of the wrong shape, MUST be
refused. Money limits MUST be in the field's currency, and amounts compare
exactly, as decimals. Only the relay sees limits; the other party never does.

- A party's own `offer` or `counter` outside its limits MUST be refused before
  it is recorded.
- Terms outside the confirming party's limits MUST be flagged field by field on
  the confirmation card (§8), which then asks to accept *anyway*.
- When both parties limit the same field (same name and type) and the bounds
  cannot both be met, both parties MUST be told that no deal is possible on
  that field. Neither number is revealed. A meeting window must leave time
  between start and end, so windows that only touch cannot be met; any other
  bounds that touch can. Bounds in two different currencies are not compared.
  Only the relay can say this: neither agent can declare a deal hopeless
  without leaking its own number.

Limits are fixed once declared. A party that could move its bound and ask
again could find the other's number one bit at a time.

[`vectors/limits.json`](vectors/limits.json) has limits to refuse, terms to
check, and pairs that cannot meet.

### Circling

Without limits the relay can still see a stall. When the last four moves are
all `counter` or `need_more_detail`, and none of them tabled terms that were not
on the table before them, the room is **circling**. The relay SHOULD tell both
parties once, on the move that tips it. Any new terms, however small a
concession, count as progress. The relay MUST NOT close the room for it; the
humans decide. [`vectors/circling.json`](vectors/circling.json) has cases.

## 8. Human in the loop

`approve`, `reject` and `cancel` are never released by an agent alone. The relay
answers the agent with `pending_human`, the confirmation goes to the human's
channel, and only the human's response releases the move. A human who
negotiates in person (§10) acts for themselves, and their moves need no
second confirmation: this section exists to keep an agent from deciding alone.

The confirmation card renders **typed fields from the declared schema**, not
the agent's summary of them. If the human confirms a retelling, the
confirmation is theatre, and every injection that reaches the agent reaches
the decision. With limits (§7), the card marks each field that falls outside
them.

The channel is not part of the protocol; it sits behind a notifier interface.
It needs push, because §6 makes the room responsible for chasing its human.
The hosted Taasky relay uses Telegram; Slack fits a workspace.

Why a human is there differs by deployment. Across organisations, the other
side cannot be trusted. Inside one, trust is not the question — accountability
is: the approval is the record of who owned the decision.

## 9. MCP binding

Agents reach a relay as an MCP server, over Streamable HTTP. The tools:

| Tool | Does | Human |
| --- | --- | --- |
| `negotiation_open` | create a room: `subject_schema`, optional `limits`; returns an invite link | — |
| `negotiation_join` | enter by `invite_code`, with own `subject_schema` and optional `limits` | — |
| `negotiation_list` | the caller's rooms: state, whose turn, nearest deadline | — |
| `negotiation_read` | one room: state, every round, the terms on the table and their `subject_hash` | — |
| `negotiation_propose` | `offer` / `counter` / `need_more_detail`, with `subject` and optional `deadline` | — |
| `negotiation_respond` | `approve` (with `subject_hash`) / `reject` | **required** |
| `negotiation_cancel` | withdraw, out of turn if need be | **required** |

Every tool that returns the other party's content MUST mark it as counterparty
data, not instructions.

A relay MAY be used without any account. Then `negotiation_open` and
`negotiation_join` each return a **room token**, the agent's seat in that one
room, and every later call names the room by it. The token is the whole
credential and SHOULD be stored only as a hash. An agent that passes an earlier
room token (`previous_room_token`) when it opens or joins stays the same party,
so its human's confirmation channel carries over. A relay MAY also offer
accounts, through OAuth or a key, so that one human's agents share rooms and a
channel.

## 10. Rooms and invitations

The initiator opens a room and gets an invitation link, which it sends to the
other side out of band. Opening the link lets the other side's agent join, and
lands it directly in the negotiation. Nothing has to be registered before the
first useful action: the human is first asked for something when a move needs
their confirmation (§8), and binding the confirmation channel then is what
registers them, at the moment there is a real deal to confirm.

The invited side does not need an agent at all. A relay SHOULD let the
invitation open a page where a person joins the room themselves. That person
negotiates in the shape they were invited to: their schema is the initiator's,
and their terms are entered through a form built from it. Every network starts
with one side that has an agent and one that does not; requiring an agent on
both sides would cap it at people who already run one.

An invitation expires. The hosted Taasky relay gives it 72 hours.

## 11. Threat notes

- `subject` and schema labels are counterparty-authored. They never enter a
  system prompt and are never treated as instructions.
- `from` is assigned by the relay. A sender-supplied identity field would be an
  impersonation primitive.
- Strict validation means rejecting the whole message, never repairing it.
- Limits are fixed once declared, and "cannot meet" answers yes or no per
  field, so neither side can probe for the other's bound.
- A model-based injection check is a filter, not a guarantee. The human
  confirmation in §8 is the actual backstop.

## 12. Conformance

An implementation is conformant when it passes the files in
[`vectors/`](vectors). They are plain JSON, so an implementation in any
language can run them; [`test/vectors.test.ts`](test/vectors.test.ts) shows how
the reference implementation does. Refusals are checked by outcome, not by
message: the wording is the implementation's own, but a rejected subject names
the path of the first problem (`subject.price`, `subject.slots[0]`).

## 13. Open questions

1. Whether v1 needs a free-text `note` field. Starting without one.
2. Where sealing lands in the envelope when end-to-end encryption arrives.
3. Handles and discovery — deferred until there is a network to search.
4. More than two parties in a room.
5. A protocol-level way for the human, not only the agent, to set limits.
