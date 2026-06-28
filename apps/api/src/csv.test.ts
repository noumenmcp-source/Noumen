import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv.js";

describe("parseCsv", () => {
  it("parses a simple header + rows", () => {
    expect(parseCsv("email,name\r\na@b.com,Jane\r\nc@d.com,Bob")).toEqual([
      ["email", "name"],
      ["a@b.com", "Jane"],
      ["c@d.com", "Bob"],
    ]);
  });

  it("handles quoted fields with commas, quotes and newlines", () => {
    expect(parseCsv('email,note\n"a@b.com","Doe, ""Jane""\nline2"')).toEqual([
      ["email", "note"],
      ["a@b.com", 'Doe, "Jane"\nline2'],
    ]);
  });

  it("handles LF-only and a trailing newline", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps empty trailing fields", () => {
    expect(parseCsv("a,b,c\n1,,3")).toEqual([
      ["a", "b", "c"],
      ["1", "", "3"],
    ]);
  });
});
