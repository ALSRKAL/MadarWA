import { describe, expect, it } from "vitest";
import { createPinRecord, randomHex, validatePinFormat, verifyPin } from "../src/shared/utils/pin";

const ITERATIONS = 1000;

describe("PIN format", () => {
  it("accepts 4 to 8 non-trivial digits", () => {
    expect(validatePinFormat("1234").valid).toBe(true);
    expect(validatePinFormat("91827364").valid).toBe(true);
  });

  it("rejects short, long, non-numeric and repeated PINs", () => {
    expect(validatePinFormat("123").valid).toBe(false);
    expect(validatePinFormat("123456789").valid).toBe(false);
    expect(validatePinFormat("12a4").valid).toBe(false);
    expect(validatePinFormat("1111").valid).toBe(false);
    expect(validatePinFormat("").valid).toBe(false);
  });
});

describe("PBKDF2 PIN hashing", () => {
  it("never stores the plaintext and verifies the correct PIN", async () => {
    const record = await createPinRecord("482913", ITERATIONS);
    expect(record.hash).toHaveLength(64);
    expect(record.salt).toHaveLength(32);
    expect(record.hash).not.toContain("482913");
    expect(await verifyPin("482913", record, ITERATIONS)).toBe(true);
  });

  it("rejects wrong PINs and malformed records", async () => {
    const record = await createPinRecord("482913", ITERATIONS);
    expect(await verifyPin("482914", record, ITERATIONS)).toBe(false);
    expect(await verifyPin("482913", { hash: "", salt: "" }, ITERATIONS)).toBe(false);
    expect(await verifyPin("abc", record, ITERATIONS)).toBe(false);
  });

  it("uses a fresh salt and hash for each record", async () => {
    const one = await createPinRecord("482913", ITERATIONS);
    const two = await createPinRecord("482913", ITERATIONS);
    expect(one.salt).not.toBe(two.salt);
    expect(one.hash).not.toBe(two.hash);
  });

  it("generates hex tokens of the requested length", () => {
    expect(randomHex(8)).toMatch(/^[a-f0-9]{16}$/);
    expect(randomHex(32)).toMatch(/^[a-f0-9]{64}$/);
  });
});
