import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Recursively collect non-test .ts source files under `dir`. */
function findSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findSourceFiles(full));
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

describe("ADR-1: social-intel never imports the CDP core/identity", () => {
  it("no source file references @cdp-us/core-cdp", () => {
    const forbidden = "@cdp-us/core-cdp";
    const violations = findSourceFiles(here).filter((file) =>
      readFileSync(file, "utf-8").includes(forbidden),
    );
    expect(
      violations,
      `social-intel must not build profiles via the CDP core: ${violations.join(", ")}`,
    ).toEqual([]);
  });
});
