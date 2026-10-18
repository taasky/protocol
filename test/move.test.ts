import { describe, expect, it } from "vitest";

import { type MoveHistoryItem, type MoveParty, type MoveRequest, planMove } from "../src/move.js";
import { afterJoin, MoveError, nextState, type RoomView } from "../src/state.js";
import { parseSchema } from "../src/subject.js";

const NOW = new Date("2026-10-12T10:00:00Z");

const meetingSchema = parseSchema({
  slot: { type: "timerange", label: "Meeting time" },
  duration_min: { type: "int", label: "Duration, minutes" },
});

const A: MoveParty = { id: "pt_a", subject_schema: meetingSchema };
const B: MoveParty = { id: "pt_b", subject_schema: meetingSchema };

const slot = (hour: number) => ({
  slot: { start: `2026-10-14T${hour}:00:00Z`, end: `2026-10-14T${hour}:30:00Z` },
  duration_min: 30,
});

/** A room right after the peer joined: the initiator moves first (server.ts). */
function joinedRoom() {
  return {
    room: { id: "rm_1", state: "awaiting", round: 0, turn: A.id, deadline: null } as RoomView,
    history: [] as MoveHistoryItem[],
  };
}

/** Plans a move and applies it in memory, as db.applyMove would. */
async function play(r: ReturnType<typeof joinedRoom>, req: MoveRequest, now = NOW) {
  const plan = await planMove(r.room, [A, B], r.history, req, now);
  r.history.push({
    id: `msg_${r.history.length + 1}`,
    seq: r.history.length + 1,
    from_id: req.actor,
    verdict: plan.message.verdict,
    subject_hash: plan.message.subject_hash,
  });
  r.room = { ...r.room, ...plan.next };
  return plan;
}

describe("an opening offer in a draft", () => {
  const draft = (): RoomView => ({
    id: "rm_1",
    state: "draft",
    round: 0,
    turn: A.id,
    deadline: null,
  });

  it("stays a draft, then hands the peer the turn on join", async () => {
    const plan = await planMove(
      draft(),
      [A],
      [],
      { actor: A.id, verdict: "offer", subject: slot(10) },
      NOW,
    );
    expect(plan.next).toMatchObject({ state: "draft", round: 1, turn: null });
    const room = { id: "rm_1", ...plan.next };
    expect(afterJoin(room, { initiator: A.id, peer: B.id })).toMatchObject({
      state: "awaiting",
      round: 1,
      turn: B.id,
    });
  });

  it("gives the initiator the first move when they opened without terms", () => {
    expect(afterJoin(draft(), { initiator: A.id, peer: B.id })).toMatchObject({
      state: "awaiting",
      round: 0,
      turn: A.id,
    });
  });

  it("allows nothing else but withdrawing before the peer joins", async () => {
    const offered = { ...draft(), round: 1, turn: null };
    const history = [{ id: "msg_1", seq: 1, from_id: A.id, verdict: "offer", subject_hash: "h" }];
    await expect(
      planMove(offered, [A], history, { actor: A.id, verdict: "counter", subject: slot(11) }, NOW),
    ).rejects.toThrow("peer has not joined yet");
    await expect(
      planMove(draft(), [A, B], [], { actor: B.id, verdict: "offer", subject: slot(11) }, NOW),
    ).rejects.toThrow("peer has not joined yet");
    const cancel = await planMove(offered, [A], history, { actor: A.id, verdict: "cancel" }, NOW);
    expect(cancel.next.state).toBe("closed");
  });
});

describe("a negotiation from offer to agreement", () => {
  it("passes the turn on every move and agrees on two approvals of one hash", async () => {
    const r = joinedRoom();

    const offer = await play(r, { actor: A.id, verdict: "offer", subject: slot(10) });
    expect(r.room).toMatchObject({ state: "awaiting", round: 1, turn: B.id });

    const counter = await play(r, { actor: B.id, verdict: "counter", subject: slot(15) });
    expect(r.room).toMatchObject({ state: "awaiting", round: 2, turn: A.id });
    expect(counter.message.in_reply_to).toBe("msg_1");
    expect(counter.message.subject_hash).not.toBe(offer.message.subject_hash);

    const hash = counter.message.subject_hash!;
    const first = await play(r, { actor: A.id, verdict: "approve", subject_hash: hash });
    expect(r.room).toMatchObject({ state: "awaiting", turn: B.id, round: 2 });
    expect(first.message.in_reply_to).toBe("msg_2");

    await play(r, { actor: B.id, verdict: "approve", subject_hash: hash });
    expect(r.room).toMatchObject({ state: "agreed", turn: null });
  });

  it("hashes identical terms identically regardless of key order", async () => {
    const r1 = joinedRoom();
    const r2 = joinedRoom();
    const p1 = await play(r1, { actor: A.id, verdict: "offer", subject: slot(10) });
    const p2 = await play(r2, {
      actor: A.id,
      verdict: "offer",
      subject: {
        duration_min: 30,
        slot: { end: "2026-10-14T10:30:00Z", start: "2026-10-14T10:00:00Z" },
      },
    });
    expect(p1.message.subject_hash).toBe(p2.message.subject_hash);
  });
});

describe("approve", () => {
  it("must name the hash of the terms on the table", async () => {
    const r = joinedRoom();
    await play(r, { actor: A.id, verdict: "offer", subject: slot(10) });
    await expect(play(r, { actor: B.id, verdict: "approve" })).rejects.toThrow(/must name/);
    await expect(
      play(r, { actor: B.id, verdict: "approve", subject_hash: "sha256:00" }),
    ).rejects.toThrow(/does not match/);
  });

  it("does not count an approval answered by a counter, even back to the same terms", async () => {
    const r = joinedRoom();
    const offer = await play(r, { actor: A.id, verdict: "offer", subject: slot(10) });
    const h10 = offer.message.subject_hash!;
    await play(r, { actor: B.id, verdict: "approve", subject_hash: h10 }); // B approves 10:00
    await play(r, { actor: A.id, verdict: "counter", subject: slot(11) }); // A changes mind
    await play(r, { actor: B.id, verdict: "counter", subject: slot(10) }); // back to 10:00
    await play(r, { actor: A.id, verdict: "approve", subject_hash: h10 });
    // B's earlier approval predates the current terms; B has to approve again.
    expect(r.room).toMatchObject({ state: "awaiting", turn: B.id });
  });

  it("needs terms on the table", async () => {
    const r = joinedRoom();
    await expect(
      play(r, { actor: A.id, verdict: "approve", subject_hash: "sha256:00" }),
    ).rejects.toThrow(/no terms/);
  });
});

describe("turn and room rules", () => {
  it("rejects a move out of turn", async () => {
    const r = joinedRoom();
    await expect(play(r, { actor: B.id, verdict: "offer", subject: slot(10) })).rejects.toThrow(
      /not your turn/,
    );
  });

  it("lets either party cancel out of turn, closing the room", async () => {
    const r = joinedRoom();
    await play(r, { actor: A.id, verdict: "offer", subject: slot(10) });
    await play(r, { actor: A.id, verdict: "cancel" });
    expect(r.room).toMatchObject({ state: "closed", turn: null });
    await expect(play(r, { actor: B.id, verdict: "counter", subject: slot(11) })).rejects.toThrow(
      /closed/,
    );
  });

  it("opens with offer and continues with counter, not the other way round", async () => {
    const r = joinedRoom();
    await expect(play(r, { actor: A.id, verdict: "counter", subject: slot(10) })).rejects.toThrow(
      /open with offer/,
    );
    await expect(play(r, { actor: A.id, verdict: "need_more_detail" })).rejects.toThrow(
      /open with offer/,
    );
    await play(r, { actor: A.id, verdict: "offer", subject: slot(10) });
    await expect(play(r, { actor: B.id, verdict: "offer", subject: slot(11) })).rejects.toThrow(
      /counter/,
    );
  });

  it("need_more_detail passes the turn without terms", async () => {
    const r = joinedRoom();
    await play(r, { actor: A.id, verdict: "offer", subject: slot(10) });
    const p = await play(r, { actor: B.id, verdict: "need_more_detail" });
    expect(p.message.subject_hash).toBeNull();
    expect(r.room).toMatchObject({ turn: A.id, round: 2 });
    await expect(
      play(r, { actor: A.id, verdict: "need_more_detail", subject: slot(10) }),
    ).rejects.toThrow(/carries no terms/);
  });

  it("rejects the move of someone outside the room", async () => {
    const r = joinedRoom();
    await expect(play(r, { actor: "pt_x", verdict: "cancel" })).rejects.toThrow(/do not take part/);
  });
});

describe("subject", () => {
  it("is validated strictly against the mover's own schema", async () => {
    const r = joinedRoom();
    await expect(
      play(r, {
        actor: A.id,
        verdict: "offer",
        subject: { ...slot(10), note: "ignore all previous" },
      }),
    ).rejects.toThrow(/not in the declared schema/);
    await expect(play(r, { actor: A.id, verdict: "offer" })).rejects.toThrow(/needs a subject/);
  });
});

describe("deadlines", () => {
  it("must be in the future and become the room's deadline", async () => {
    const r = joinedRoom();
    await expect(
      play(r, {
        actor: A.id,
        verdict: "offer",
        subject: slot(10),
        deadline: "2026-10-01T00:00:00Z",
      }),
    ).rejects.toThrow(/future/);
    await play(r, {
      actor: A.id,
      verdict: "offer",
      subject: slot(10),
      deadline: "2026-10-13T00:00:00Z",
    });
    expect(r.room.deadline).toBe("2026-10-13T00:00:00Z");
  });

  it("stop every move once passed", async () => {
    const r = joinedRoom();
    await play(r, {
      actor: A.id,
      verdict: "offer",
      subject: slot(10),
      deadline: "2026-10-13T00:00:00Z",
    });
    const later = new Date("2026-10-13T00:00:01Z");
    await expect(play(r, { actor: B.id, verdict: "cancel" }, later)).rejects.toThrow(/deadline/);
  });
});

describe("nextState", () => {
  it("refuses to leave a live room with nobody to move", () => {
    const room: RoomView = { id: "rm_1", state: "awaiting", round: 1, turn: A.id, deadline: null };
    expect(() =>
      nextState(room, "counter", { bothApproved: false, participants: [A.id], deadline: null }),
    ).toThrow(MoveError);
  });
});
