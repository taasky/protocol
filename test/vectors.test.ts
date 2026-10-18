// Runs the language-neutral vectors in vectors/ against this implementation.
// Another implementation is conformant when it passes the same files.

import { describe, expect, it } from "vitest";
import {
  afterJoin,
  cannotMeet,
  canonicalize,
  checkLimits,
  isCircling,
  MoveError,
  type MoveHistoryItem,
  type MoveParty,
  parseLimits,
  parseSchema,
  planMove,
  type RoomView,
  SubjectError,
  subjectHash,
  type Verdict,
  validateSubject,
} from "../src/index.js";
import canonical from "../vectors/canonical.json" with { type: "json" };
import circling from "../vectors/circling.json" with { type: "json" };
import limits from "../vectors/limits.json" with { type: "json" };
import moves from "../vectors/moves.json" with { type: "json" };
import subjects from "../vectors/subjects.json" with { type: "json" };

describe("canonical.json", () => {
  for (const c of canonical.cases) {
    it(c.name, async () => {
      expect(canonicalize(c.input)).toBe(c.canonical);
      expect(await subjectHash(c.input)).toBe(c.subject_hash);
    });
  }
});

describe("subjects.json", () => {
  const schema = parseSchema(subjects.schema);
  for (const c of subjects.cases) {
    it(c.name, () => {
      const run = () => validateSubject(schema, c.subject);
      if ("valid" in c) {
        expect(run).not.toThrow();
        return;
      }
      expect(run).toThrow(SubjectError);
      try {
        run();
      } catch (e) {
        expect((e as Error).message.startsWith(`${c.error_path}:`), (e as Error).message).toBe(
          true,
        );
      }
    });
  }
});

describe("limits.json", () => {
  const schema = parseSchema(limits.schema);
  for (const c of limits.invalid) {
    it(`refuses ${c.name}`, () => {
      expect(() => parseLimits(schema, c.limits)).toThrow(SubjectError);
    });
  }
  for (const c of limits.check) {
    it(`check: ${c.name}`, () => {
      expect(checkLimits(schema, parseLimits(schema, c.limits), c.subject)).toEqual(c.breaches);
    });
  }
  for (const c of limits.cannot_meet) {
    it(`cannot_meet: ${c.name}`, () => {
      const side = (l: unknown) => ({ schema, limits: parseLimits(schema, l) });
      expect(cannotMeet(side(c.a), side(c.b))).toEqual(c.fields);
    });
  }
});

describe("circling.json", () => {
  for (const c of circling.cases) {
    it(c.name, () => {
      const history = c.moves.map(([verdict, hash], i) => ({
        id: `msg_${i + 1}`,
        seq: i + 1,
        from_id: i % 2 ? "b" : "a",
        verdict: verdict as string,
        subject_hash: hash ?? null,
      }));
      expect(isCircling(history)).toBe(c.circling);
    });
  }
});

describe("moves.json", () => {
  const schema = parseSchema(moves.schema);
  const parties: MoveParty[] = [
    { id: "a", subject_schema: schema },
    { id: "b", subject_schema: schema },
  ];
  const now = new Date(moves.now);
  const terms = moves.terms as Record<string, unknown>;

  for (const c of moves.cases) {
    it(c.name, async () => {
      let room: RoomView = {
        id: "rm_1",
        state: "start" in c && c.start === "draft" ? "draft" : "awaiting",
        round: 0,
        turn: "a",
        deadline: null,
      };
      const history: MoveHistoryItem[] = [];
      for (const [i, step] of (c.steps as Step[]).entries()) {
        if (step.join) {
          room = { ...room, ...afterJoin(room, { initiator: "a", peer: step.join }) };
          if (step.room) expect(room, `step ${i}`).toMatchObject(step.room);
          continue;
        }
        const onTable = history.findLast((m) => m.verdict === "offer" || m.verdict === "counter");
        const req = {
          actor: step.actor!,
          verdict: step.verdict!,
          ...(step.terms && { subject: terms[step.terms] }),
          ...(step.subject !== undefined && { subject: step.subject }),
          ...(step.approve && {
            subject_hash: step.approve === "on_table" ? onTable!.subject_hash! : step.approve,
          }),
        };
        const planned = planMove(room, parties, history, req, now);
        if (step.refused) {
          await expect(planned, `step ${i}: ${step.refused}`).rejects.toThrow(
            step.subject ? SubjectError : MoveError,
          );
          continue;
        }
        const plan = await planned;
        history.push({
          id: `msg_${history.length + 1}`,
          seq: history.length + 1,
          from_id: step.actor!,
          verdict: plan.message.verdict,
          subject_hash: plan.message.subject_hash,
        });
        room = { ...room, ...plan.next };
        if (step.room) expect(room, `step ${i}`).toMatchObject(step.room);
      }
    });
  }
});

interface Step {
  actor?: string;
  verdict?: Verdict;
  /** The peer joining a draft, instead of a move. */
  join?: string;
  terms?: string;
  subject?: unknown;
  approve?: string;
  room?: Partial<RoomView>;
  refused?: string;
}
