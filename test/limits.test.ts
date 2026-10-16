import { describe, expect, it } from "vitest";

import { cannotMeet, checkLimits, parseLimits } from "../src/limits.js";
import { parseSchema, SubjectError } from "../src/subject.js";

const schema = parseSchema({
  price: { type: "money", label: "Price", currency: "EUR" },
  meeting_time: { type: "timerange", label: "Meeting time" },
  seats: { type: "int", label: "Seats" },
  pickup: { type: "date", label: "Pickup day" },
  place: { type: "enum", label: "Place", values: ["office", "cafe", "online"] },
  delivery: { type: "bool", label: "Delivery" },
  note: { type: "string", label: "Note", optional: true },
});

const eur = (amount: string) => ({ amount, currency: "EUR" });

describe("parseLimits", () => {
  it("takes the bounds each type allows", () => {
    expect(
      parseLimits(schema, {
        price: { max: eur("100.00") },
        seats: { min: 2, max: 4 },
        place: { one_of: ["cafe", "online"] },
        delivery: { equals: true },
      }),
    ).toEqual({
      price: { max: eur("100.00") },
      seats: { min: 2, max: 4 },
      place: { one_of: ["cafe", "online"] },
      delivery: { equals: true },
    });
    expect(parseLimits(schema, undefined)).toBeNull();
  });

  it("refuses fields it cannot bound and shapes that do not fit", () => {
    const bad = [
      { colour: { max: 1 } },
      { note: { max: 1 } },
      { place: { max: "cafe" } },
      { place: { one_of: ["moon"] } },
      { price: { max: { amount: "100", currency: "USD" } } },
      { seats: { min: 5, max: 4 } },
      { price: { max: 100 } },
      { pickup: { min: "2026-02-30" } },
    ];
    for (const raw of bad)
      expect(() => parseLimits(schema, raw), JSON.stringify(raw)).toThrow(SubjectError);
  });
});

describe("checkLimits", () => {
  const limits = parseLimits(schema, {
    price: { max: eur("100.00") },
    meeting_time: { min: "2026-12-01T09:00:00+01:00", max: "2026-12-01T18:00:00+01:00" },
    place: { one_of: ["cafe", "online"] },
  });

  it("passes terms inside the limits", () => {
    expect(
      checkLimits(schema, limits, {
        price: eur("100"),
        meeting_time: { start: "2026-12-01T09:00:00+01:00", end: "2026-12-01T10:00:00+01:00" },
        place: "cafe",
      }),
    ).toEqual([]);
  });

  it("names every breach with the bound it broke", () => {
    expect(
      checkLimits(schema, limits, {
        price: eur("100.01"),
        meeting_time: { start: "2026-12-01T17:30:00+01:00", end: "2026-12-01T18:30:00+01:00" },
        place: "office",
      }),
    ).toEqual([
      { field: "price", rule: "above_max", bound: eur("100.00") },
      { field: "meeting_time", rule: "above_max", bound: "2026-12-01T18:00:00+01:00" },
      { field: "place", rule: "not_allowed", bound: ["cafe", "online"] },
    ]);
  });

  it("compares times across offsets and amounts without floats", () => {
    // 08:30 UTC is 09:30 in +01:00: inside the window.
    expect(
      checkLimits(schema, limits, {
        meeting_time: { start: "2026-12-01T08:30:00Z", end: "2026-12-01T09:00:00Z" },
      }),
    ).toEqual([]);
    const big = parseLimits(schema, { price: { max: eur("999999999999999.99") } });
    expect(checkLimits(schema, big, { price: eur("999999999999999.98") })).toEqual([]);
  });

  it("checks the other side's terms only on fields declared alike", () => {
    const theirs = parseSchema({ price: { type: "int", label: "Price" } });
    expect(checkLimits(schema, limits, { price: 500 }, theirs)).toEqual([]);
  });
});

describe("cannotMeet", () => {
  const side = (limits: unknown) => ({ schema, limits: parseLimits(schema, limits) });

  it("finds a deal that is impossible, without either number", () => {
    const buyer = side({ price: { max: eur("80.00") } });
    const seller = side({ price: { min: eur("90.00") } });
    expect(cannotMeet(buyer, seller)).toEqual(["price"]);
    expect(cannotMeet(buyer, side({ price: { min: eur("80.00") } }))).toEqual([]);
  });

  it("needs a window with time in it for a meeting", () => {
    const morning = side({ meeting_time: { max: "2026-12-01T12:00:00Z" } });
    const afternoon = side({ meeting_time: { min: "2026-12-01T12:00:00Z" } });
    expect(cannotMeet(morning, afternoon)).toEqual(["meeting_time"]);
  });

  it("compares enums, bools and dates; stays silent where it cannot tell", () => {
    expect(
      cannotMeet(
        side({
          place: { one_of: ["office"] },
          delivery: { equals: true },
          pickup: { max: "2026-12-01" },
        }),
        side({
          place: { one_of: ["cafe"] },
          delivery: { equals: false },
          pickup: { min: "2026-12-02" },
        }),
      ),
    ).toEqual(["place", "delivery", "pickup"]);
    expect(cannotMeet(side({ price: { max: eur("1.00") } }), side(null))).toEqual([]);
    expect(cannotMeet(side({ seats: { max: 2 } }), side({ seats: { max: 1 } }))).toEqual([]);
  });
});
