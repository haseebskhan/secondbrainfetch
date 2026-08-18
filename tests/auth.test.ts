import { describe, it, expect } from "vitest";
import { isValidWebhookSecret } from "../src/auth.js";

describe("isValidWebhookSecret", () => {
  it("returns true when provided matches expected", () => {
    expect(isValidWebhookSecret("abc123", "abc123")).toBe(true);
  });

  it("returns false when provided does not match", () => {
    expect(isValidWebhookSecret("wrong", "abc123")).toBe(false);
  });

  it("returns false when provided is undefined", () => {
    expect(isValidWebhookSecret(undefined, "abc123")).toBe(false);
  });

  it("returns false when provided is null", () => {
    expect(isValidWebhookSecret(null, "abc123")).toBe(false);
  });

  it("returns false when provided is empty string", () => {
    expect(isValidWebhookSecret("", "abc123")).toBe(false);
  });
});
