import { describe, expect, it } from "vitest";
import { appendTripYears } from "./trip-titles";

describe("appendTripYears", () => {
  it("appends a single trip year", () => {
    expect(appendTripYears("Porto", ["2025-04-14", "2025-04-17"])).toBe("Porto 2025");
  });

  it("appends multiple years in ascending order", () => {
    expect(appendTripYears("Japan", ["2026-01-02", "2025-12-30", "2026-01-05"])).toBe(
      "Japan 2025/2026",
    );
  });

  it("leaves the title unchanged when there are no valid day dates", () => {
    expect(appendTripYears("Untitled", ["unsorted"])).toBe("Untitled");
  });
});
