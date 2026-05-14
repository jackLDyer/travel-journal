import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatDay,
  getDestinationDirectory,
  isSupportedImage,
  parseExifDate,
  planPhotoSort,
  resolveAvailablePath,
} from "./photo-sorter";

afterEach(async () => {
  await rm(path.join(process.cwd(), ".tmp-tests"), { recursive: true, force: true });
});

describe("photo sorter", () => {
  it("filters supported image types case-insensitively", () => {
    expect(isSupportedImage("photo.JPG")).toBe(true);
    expect(isSupportedImage("photo.heic")).toBe(true);
    expect(isSupportedImage("photo.mov")).toBe(false);
  });

  it("formats dates as local YYYY-MM-DD days", () => {
    expect(formatDay(new Date(2026, 4, 14, 12, 30))).toBe("2026-05-14");
  });

  it("parses EXIF timestamp strings and rejects missing metadata", () => {
    expect(formatDay(parseExifDate("2026:05:14 09:10:11") as Date)).toBe("2026-05-14");
    expect(parseExifDate(undefined)).toBeNull();
  });

  it("generates dated and unsorted destination directories", () => {
    expect(getDestinationDirectory("src/content/trips", "paris", "2026-05-14")).toBe(
      path.join("src/content/trips", "paris", "days", "2026-05-14", "photos"),
    );
    expect(getDestinationDirectory("src/content/trips", "paris", null)).toBe(
      path.join("src/content/trips", "paris", "days", "unsorted"),
    );
  });

  it("adds numeric suffixes for destination collisions", async ({ task }) => {
    const root = path.join(process.cwd(), ".tmp-tests", task.id);
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "photo.jpg"), "existing");

    const reserved = new Set<string>();
    const first = await resolveAvailablePath(root, "photo.jpg", reserved);
    const second = await resolveAvailablePath(root, "photo.jpg", reserved);

    expect(path.basename(first)).toBe("photo-2.jpg");
    expect(path.basename(second)).toBe("photo-3.jpg");
  });

  it("plans unsupported-date files into unsorted without mutating input", async ({ task }) => {
    const root = path.join(process.cwd(), ".tmp-tests", task.id);
    const input = path.join(root, "input");
    const output = path.join(root, "trips");
    await mkdir(input, { recursive: true });
    await writeFile(path.join(input, "a.jpg"), "not real exif");
    await writeFile(path.join(input, "ignore.txt"), "ignored");

    const result = await planPhotoSort({
      input,
      trip: "rome",
      contentRoot: output,
      dryRun: true,
    });

    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].day).toBe("unsorted");
    expect(result.operations[0].destination).toBe(path.join(output, "rome", "days", "unsorted", "a.jpg"));
    expect(result.counts.get("unsorted")).toBe(1);
  });
});
