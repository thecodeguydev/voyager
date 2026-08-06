import { describe, expect, it } from "vitest";
import { isManualAssignment } from "../../src/dispatch/manualAssignment.js";

describe("isManualAssignment", () => {
  it("is true for a manual-source assignment", () => {
    expect(isManualAssignment({ source: "manual" })).toBe(true);
  });

  it("is false for an auto-source assignment", () => {
    expect(isManualAssignment({ source: "auto" })).toBe(false);
  });
});
