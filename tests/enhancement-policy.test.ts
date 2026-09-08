import { describe, expect, test } from "bun:test";
import { enhancementTier } from "../src/components/lib/enhancement-policy";

const desktop = { reducedMotion: false, saveData: false, coarsePointer: false };

describe("optional artwork policy", () => {
  test("explicit accessibility and data preferences win over device capacity", () => {
    expect(enhancementTier({ ...desktop, reducedMotion: true, memory: 16, cores: 16 })).toBe(
      "static",
    );
    expect(enhancementTier({ ...desktop, saveData: true })).toBe("static");
    expect(enhancementTier({ ...desktop, webglAvailable: false })).toBe("static");
  });

  test("touch and constrained devices keep the lighter interaction", () => {
    expect(enhancementTier({ ...desktop, coarsePointer: true })).toBe("light");
    expect(enhancementTier({ ...desktop, memory: 4, cores: 16 })).toBe("light");
    expect(enhancementTier({ ...desktop, memory: 16, cores: 4 })).toBe("light");
    for (const connectionType of ["slow-2g", "2g", "3g"]) {
      expect(enhancementTier({ ...desktop, connectionType })).toBe("light");
    }
  });

  test("missing optional capacity hints preserve the full tier", () => {
    expect(enhancementTier(desktop)).toBe("full");
    expect(enhancementTier({ ...desktop, memory: 8, cores: 8 })).toBe("full");
    expect(enhancementTier({ ...desktop, connectionType: "4g" })).toBe("full");
    expect(enhancementTier({ ...desktop, webglAvailable: true })).toBe("full");
  });
});
