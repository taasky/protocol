import { describe, expect, it } from "vitest";

import { isCircling, type MoveHistoryItem } from "../src/move.js";

let seq = 0;
const m = (from: string, verdict: string, hash: string | null = null): MoveHistoryItem => ({
  id: `msg_${++seq}`,
  seq,
  from_id: from,
  verdict,
  subject_hash: hash,
});

describe("isCircling", () => {
  it("catches two sides restating the same two positions", () => {
    const history = [m("a", "offer", "h1"), m("b", "counter", "h2")];
    for (let i = 0; i < 2; i++) history.push(m("a", "counter", "h1"), m("b", "counter", "h2"));
    expect(isCircling(history.slice(0, 5))).toBe(false);
    expect(isCircling(history)).toBe(true);
  });

  it("lets any new terms count as progress, however small", () => {
    const history = [
      m("a", "offer", "h1"),
      m("b", "counter", "h2"),
      m("a", "counter", "h1"),
      m("b", "counter", "h2"),
      m("a", "counter", "h3"),
    ];
    expect(isCircling(history)).toBe(false);
  });

  it("catches a run of requests for more detail", () => {
    const history = [
      m("a", "offer", "h1"),
      ...Array.from({ length: 4 }, (_, i) => m(i % 2 ? "a" : "b", "need_more_detail")),
    ];
    expect(isCircling(history)).toBe(true);
  });

  it("does not count an approval as circling", () => {
    const history = [
      m("a", "offer", "h1"),
      m("b", "counter", "h2"),
      m("a", "counter", "h1"),
      m("b", "counter", "h2"),
      m("a", "approve", "h2"),
    ];
    expect(isCircling(history)).toBe(false);
  });
});
