import { describe, expect, it } from "vitest";

import { parseSchema, validateSubject } from "../src/subject.js";

const schema = parseSchema({
  price: { type: "money", label: "Price" },
  rent: { type: "money", label: "Rent", currency: "EUR", optional: true },
  ready_by: { type: "date", label: "Ready by" },
});
const ok = (subject: object) => () =>
  validateSubject(schema, {
    ready_by: "2026-11-30",
    price: { amount: "10", currency: "EUR" },
    ...subject,
  });

describe("money", () => {
  it("takes a decimal string amount and an ISO 4217 currency", () => {
    expect(ok({ price: { amount: "1500.50", currency: "EUR" } })).not.toThrow();
    expect(ok({ price: { amount: "1500", currency: "JPY" } })).not.toThrow();
    expect(ok({ price: { amount: "1.250", currency: "KWD" } })).not.toThrow();
  });

  it("refuses floats, extra precision, bad codes and extra keys", () => {
    expect(ok({ price: { amount: 1500, currency: "EUR" } })).toThrow(/decimal string/);
    expect(ok({ price: { amount: "15.001", currency: "EUR" } })).toThrow(/at most 2 digits/);
    expect(ok({ price: { amount: "15.5", currency: "JPY" } })).toThrow(/at most 0 digits/);
    expect(ok({ price: { amount: "-5", currency: "EUR" } })).toThrow(/decimal string/);
    expect(ok({ price: { amount: "5", currency: "eur" } })).toThrow(/ISO 4217/);
    expect(ok({ price: { amount: "5", currency: "EUR", note: "x" } })).toThrow(/exactly/);
  });

  it("holds a declared currency fixed", () => {
    expect(ok({ rent: { amount: "900", currency: "EUR" } })).not.toThrow();
    expect(ok({ rent: { amount: "900", currency: "USD" } })).toThrow(/must be EUR/);
    expect(() => parseSchema({ n: { type: "int", label: "N", currency: "EUR" } })).toThrow(
      /money fields only/,
    );
  });
});

describe("date", () => {
  it("is a real day in YYYY-MM-DD", () => {
    expect(ok({ ready_by: "2028-02-29" })).not.toThrow();
    expect(ok({ ready_by: "2026-02-30" })).toThrow(/YYYY-MM-DD/);
    expect(ok({ ready_by: "2026-11-30T10:00:00Z" })).toThrow(/YYYY-MM-DD/);
  });
});
