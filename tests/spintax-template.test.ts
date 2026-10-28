import { describe, expect, it } from "vitest";
import { hasSpintax, spin } from "../src/shared/utils/spintax";
import { extractTemplateVariables, interpolateTemplate, personalizeMessage } from "../src/shared/utils/template";

const first = () => 0;
const last = () => 0.999999;

describe("spintax", () => {
  it("selects deterministic options", () => {
    expect(spin("{مرحباً|أهلاً|حياك الله}", first)).toBe("مرحباً");
    expect(spin("{مرحباً|أهلاً|حياك الله}", last)).toBe("حياك الله");
    expect(spin("Hello {world|there}", () => 0.5)).toBe("Hello there");
  });

  it("supports nested groups", () => {
    expect(spin("X {a|b {c|d}}", first)).toBe("X a");
    expect(spin("X {a|b {c|d}}", last)).toBe("X b d");
  });

  it("keeps escaped braces and double-brace placeholders intact", () => {
    expect(spin("\\{a|b\\}", first)).toBe("{a|b}");
    expect(spin("Hi {{name}}, {welcome|hello}", first)).toBe("Hi {{name}}, welcome");
  });

  it("leaves unterminated groups readable", () => {
    expect(spin("prefix {a|b", first)).toBe("prefix {a|b");
  });

  it("detects spintax but not template variables", () => {
    expect(hasSpintax("{a|b}")).toBe(true);
    expect(hasSpintax("{{name}}")).toBe(false);
    expect(hasSpintax("plain text")).toBe(false);
  });
});

describe("template interpolation", () => {
  it("interpolates supported variables and removes unknown ones", () => {
    expect(
      interpolateTemplate("مرحباً {{name}}، رقمك {{ phone }} — {{unknown}}", {
        name: "أحمد",
        phone: "966501234567",
      }),
    ).toBe("مرحباً أحمد، رقمك 966501234567 — ");
  });

  it("collapses newlines from CSV values", () => {
    expect(interpolateTemplate("Hi {{name}}", { name: "Ahmed\nAli" })).toBe("Hi Ahmed Ali");
  });

  it("extracts unique variable names", () => {
    expect(extractTemplateVariables("{{name}} {{custom1}} {{ name }} {{custom2}}")).toEqual([
      "name",
      "custom1",
      "custom2",
    ]);
  });

  it("spins before interpolating, so values are never parsed as spintax", () => {
    const output = personalizeMessage("{مرحباً|أهلاً} {{name}}", {
      variables: { name: "A{b|c}" },
      random: first,
    });
    expect(output).toBe("مرحباً A{b|c}");
  });

  it("can disable spintax while still interpolating", () => {
    expect(
      personalizeMessage("{a|b} {{name}}", {
        variables: { name: "سارة" },
        enableSpintax: false,
      }),
    ).toBe("{a|b} سارة");
  });
});
