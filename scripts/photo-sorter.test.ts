import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import exifr from "exifr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatDay,
  getDestinationDirectory,
  getOptimizedFilename,
  isSupportedImage,
  parseExifDate,
  planDayScaffolds,
  planPhotoSort,
  planTripScaffolds,
  resolveAvailablePath,
  sortPhotos,
} from "./photo-sorter";

vi.mock("exifr", () => ({
  default: {
    parse: vi.fn(),
    gps: vi.fn(),
  },
}));

beforeEach(() => {
  vi.mocked(exifr.parse).mockResolvedValue(undefined);
  vi.mocked(exifr.gps).mockResolvedValue(undefined as unknown as Awaited<ReturnType<typeof exifr.gps>>);
});

afterEach(async () => {
  await rm(path.join(process.cwd(), ".tmp-tests"), { recursive: true, force: true });
  vi.clearAllMocks();
  vi.unstubAllGlobals();
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

  it("uses webp filenames for optimized copies", () => {
    expect(getOptimizedFilename("IMG_1234.JPG")).toBe("IMG_1234.webp");
    expect(getOptimizedFilename("edited.photo.png")).toBe("edited.photo.webp");
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

  it("skips duplicate destinations instead of renaming them", async ({ task }) => {
    vi.mocked(exifr.parse).mockResolvedValue({
      DateTimeOriginal: new Date(2026, 4, 14, 12, 30),
    });
    const root = path.join(process.cwd(), ".tmp-tests", task.id);
    const input = path.join(root, "input");
    const output = path.join(root, "trips");
    const destinationDirectory = path.join(output, "rome", "days", "2026-05-14", "photos");
    await mkdir(input, { recursive: true });
    await mkdir(destinationDirectory, { recursive: true });
    await writeFile(path.join(input, "a.jpg"), "first");
    await writeFile(path.join(input, "a.png"), "second");

    const result = await planPhotoSort({
      input,
      trip: "rome",
      contentRoot: output,
      dryRun: true,
      optimize: true,
    });

    expect(result.operations).toHaveLength(1);
    expect(path.basename(result.operations[0].destination)).toBe("a.webp");
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toBe(path.join(input, "a.png"));
  });

  it("skips imports when the destination file already exists", async ({ task }) => {
    vi.mocked(exifr.parse).mockResolvedValue({
      DateTimeOriginal: new Date(2026, 4, 14, 12, 30),
    });
    const root = path.join(process.cwd(), ".tmp-tests", task.id);
    const input = path.join(root, "input");
    const output = path.join(root, "trips");
    const destinationDirectory = path.join(output, "rome", "days", "2026-05-14", "photos");
    await mkdir(input, { recursive: true });
    await mkdir(destinationDirectory, { recursive: true });
    await writeFile(path.join(input, "a.jpg"), "incoming");
    await writeFile(path.join(destinationDirectory, "a.webp"), "existing");

    const result = await planPhotoSort({
      input,
      trip: "rome",
      contentRoot: output,
      dryRun: true,
      optimize: true,
    });

    expect(result.operations).toEqual([]);
    expect(result.skipped).toEqual([path.join(input, "a.jpg")]);
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
    expect(result.scaffoldOperations).toEqual([
      {
        destination: path.join(output, "rome", "summary.md"),
        filename: "summary.md",
        content: "Write the trip summary here.\n",
      },
      {
        destination: path.join(output, "rome", "meta.yaml"),
        filename: "meta.yaml",
        content: 'coverPhoto: ""\n',
      },
    ]);
    expect(result.counts.get("unsorted")).toBe(1);
  });

  it("plans scaffold files for dated photo imports", async ({ task }) => {
    vi.mocked(exifr.parse).mockResolvedValue({
      DateTimeOriginal: new Date(2026, 4, 14, 12, 30),
    });
    const root = path.join(process.cwd(), ".tmp-tests", task.id);
    const input = path.join(root, "input");
    const output = path.join(root, "trips");
    await mkdir(input, { recursive: true });
    await writeFile(path.join(input, "a.jpg"), "not real exif");

    const result = await planPhotoSort({
      input,
      trip: "rome",
      contentRoot: output,
      dryRun: true,
    });

    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].day).toBe("2026-05-14");
    expect(result.scaffoldOperations.map((operation) => operation.destination)).toEqual([
      path.join(output, "rome", "summary.md"),
      path.join(output, "rome", "meta.yaml"),
      path.join(output, "rome", "days", "2026-05-14", "summary.md"),
      path.join(output, "rome", "days", "2026-05-14", "meta.yaml"),
    ]);
  });

  it("plans a trip-level meta file when missing", async ({ task }) => {
    const root = path.join(process.cwd(), ".tmp-tests", task.id);
    const output = path.join(root, "trips");

    const result = await planTripScaffolds(output, "rome");

    expect(result).toEqual([
      {
        destination: path.join(output, "rome", "summary.md"),
        filename: "summary.md",
        content: "Write the trip summary here.\n",
      },
      {
        destination: path.join(output, "rome", "meta.yaml"),
        filename: "meta.yaml",
        content: 'coverPhoto: ""\n',
      },
    ]);
  });

  it("does not plan an existing trip-level meta file for overwrite", async ({ task }) => {
    const root = path.join(process.cwd(), ".tmp-tests", task.id);
    const output = path.join(root, "trips");
    const tripDirectory = path.join(output, "rome");
    await mkdir(tripDirectory, { recursive: true });
    await writeFile(path.join(tripDirectory, "summary.md"), "Existing trip summary\n");
    await writeFile(path.join(tripDirectory, "meta.yaml"), 'coverPhoto: "days/2026-05-14/photos/a.webp"\n');

    const result = await planTripScaffolds(output, "rome");

    expect(result).toEqual([]);
  });

  it("does not plan existing scaffold files for overwrite", async ({ task }) => {
    const root = path.join(process.cwd(), ".tmp-tests", task.id);
    const output = path.join(root, "trips");
    const dayDirectory = path.join(output, "rome", "days", "2026-05-14");
    await mkdir(dayDirectory, { recursive: true });
    await writeFile(path.join(dayDirectory, "summary.md"), "Existing summary");
    await writeFile(path.join(dayDirectory, "meta.yaml"), "locations: []\nhighlights: []\n");

    const result = await planDayScaffolds(output, "rome", ["2026-05-14"]);

    expect(result).toEqual([]);
  });

  it("still plans day scaffolds when dated photos are skipped as duplicates", async ({ task }) => {
    vi.mocked(exifr.parse).mockResolvedValue({
      DateTimeOriginal: new Date(2026, 4, 14, 12, 30),
    });
    const root = path.join(process.cwd(), ".tmp-tests", task.id);
    const input = path.join(root, "input");
    const output = path.join(root, "trips");
    const photoDirectory = path.join(output, "rome", "days", "2026-05-14", "photos");
    await mkdir(input, { recursive: true });
    await mkdir(photoDirectory, { recursive: true });
    await writeFile(path.join(input, "a.jpg"), "new file");
    await writeFile(path.join(photoDirectory, "a.webp"), "existing duplicate");

    const result = await planPhotoSort({
      input,
      trip: "rome",
      contentRoot: output,
      dryRun: true,
      optimize: true,
    });

    expect(result.operations).toEqual([]);
    expect(result.skipped).toEqual([path.join(input, "a.jpg")]);
    expect(result.scaffoldOperations.map((operation) => operation.destination)).toEqual([
      path.join(output, "rome", "summary.md"),
      path.join(output, "rome", "meta.yaml"),
      path.join(output, "rome", "days", "2026-05-14", "summary.md"),
      path.join(output, "rome", "days", "2026-05-14", "meta.yaml"),
    ]);
  });

  it("plans optimized operations as webp without deleting originals", async ({ task }) => {
    const root = path.join(process.cwd(), ".tmp-tests", task.id);
    const input = path.join(root, "input");
    const output = path.join(root, "trips");
    await mkdir(input, { recursive: true });
    await writeFile(path.join(input, "a.JPG"), "not real exif");

    const result = await planPhotoSort({
      input,
      trip: "rome",
      contentRoot: output,
      optimize: true,
      move: true,
      dryRun: true,
    });

    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].action).toBe("optimize");
    expect(result.operations[0].destination).toBe(path.join(output, "rome", "days", "unsorted", "a.webp"));
  });

  it("plans merged day metadata locations from GPS coordinates", async ({ task }) => {
    vi.mocked(exifr.parse).mockResolvedValue({
      DateTimeOriginal: new Date(2026, 4, 14, 12, 30),
    });
    vi.mocked(exifr.gps)
      .mockResolvedValueOnce({ latitude: 41.1496, longitude: -8.6109 })
      .mockResolvedValueOnce({ latitude: 41.1497, longitude: -8.6108 })
      .mockResolvedValueOnce({ latitude: 41.1333, longitude: -8.6167 });
    const fetchMock = vi.fn(async (url: URL | RequestInfo) => {
      const longitude = Number(new URL(String(url)).searchParams.get("lon"));
      const city = longitude < -8.614 ? "Gaia" : "Porto";
      return {
        ok: true,
        json: async () => ({
          features: [
            {
              properties: {
                geocoding: { city },
              },
            },
          ],
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const root = path.join(process.cwd(), ".tmp-tests", task.id);
    const input = path.join(root, "input");
    const output = path.join(root, "trips");
    const dayDirectory = path.join(output, "rome", "days", "2026-05-14");
    await mkdir(input, { recursive: true });
    await mkdir(dayDirectory, { recursive: true });
    await writeFile(path.join(input, "a.jpg"), "first");
    await writeFile(path.join(input, "b.jpg"), "second");
    await writeFile(path.join(input, "c.jpg"), "third");
    await writeFile(
      path.join(dayDirectory, "meta.yaml"),
      "locations: [Existing]\nhighlights: [Dinner]\nnotes: keep\n",
    );

    const result = await planPhotoSort({
      input,
      trip: "rome",
      contentRoot: output,
      dryRun: true,
      geocodeCachePath: path.join(root, "cache.json"),
      geocodeDelayMs: 0,
    });

    expect(result.metadataOperations).toHaveLength(1);
    expect(result.metadataOperations[0].locations).toEqual(["Existing", "Porto", "Gaia"]);
    expect(result.metadataOperations[0].content).toContain("highlights");
    expect(result.metadataOperations[0].content).toContain("notes: keep");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("caps merged locations at three with existing locations first", async ({ task }) => {
    vi.mocked(exifr.parse).mockResolvedValue({
      DateTimeOriginal: new Date(2026, 4, 14, 12, 30),
    });
    vi.mocked(exifr.gps)
      .mockResolvedValueOnce({ latitude: 1, longitude: 1 })
      .mockResolvedValueOnce({ latitude: 2, longitude: 2 });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [{ properties: { geocoding: { city: "Detected One" } } }],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [{ properties: { geocoding: { city: "Detected Two" } } }],
        }),
      } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const root = path.join(process.cwd(), ".tmp-tests", task.id);
    const input = path.join(root, "input");
    const output = path.join(root, "trips");
    const dayDirectory = path.join(output, "rome", "days", "2026-05-14");
    await mkdir(input, { recursive: true });
    await mkdir(dayDirectory, { recursive: true });
    await writeFile(path.join(input, "a.jpg"), "first");
    await writeFile(path.join(input, "b.jpg"), "second");
    await writeFile(path.join(dayDirectory, "meta.yaml"), "locations: [Existing A, Existing B]\nhighlights: []\n");

    const result = await planPhotoSort({
      input,
      trip: "rome",
      contentRoot: output,
      dryRun: true,
      geocodeCachePath: path.join(root, "cache.json"),
      geocodeDelayMs: 0,
    });

    expect(result.metadataOperations[0].locations).toEqual([
      "Existing A",
      "Existing B",
      "Detected One",
    ]);
  });

  it("writes metadata updates and the geocode cache outside dry-run mode", async ({ task }) => {
    vi.mocked(exifr.parse).mockResolvedValue({
      DateTimeOriginal: new Date(2026, 4, 14, 12, 30),
    });
    vi.mocked(exifr.gps).mockResolvedValue({ latitude: 41.1496, longitude: -8.6109 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          features: [{ properties: { geocoding: { city: "Porto" } } }],
        }),
      })) as unknown as typeof fetch,
    );

    const root = path.join(process.cwd(), ".tmp-tests", task.id);
    const input = path.join(root, "input");
    const output = path.join(root, "trips");
    const dayDirectory = path.join(output, "rome", "days", "2026-05-14");
    const cachePath = path.join(root, "cache.json");
    await mkdir(input, { recursive: true });
    await mkdir(dayDirectory, { recursive: true });
    await writeFile(path.join(input, "a.jpg"), "source");
    await writeFile(path.join(dayDirectory, "meta.yaml"), "locations: [Existing]\nhighlights: [Dinner]\n");

    await sortPhotos({
      input,
      trip: "rome",
      contentRoot: output,
      geocodeCachePath: cachePath,
      geocodeDelayMs: 0,
    });

    const meta = await readFile(path.join(dayDirectory, "meta.yaml"), "utf8");
    expect(meta).toContain("Existing");
    expect(meta).toContain("Porto");
    expect(meta).toContain("Dinner");
    expect(await readFile(cachePath, "utf8")).toContain("Porto");
  });

  it("does not write metadata or cache files during dry-run", async ({ task }) => {
    vi.mocked(exifr.parse).mockResolvedValue({
      DateTimeOriginal: new Date(2026, 4, 14, 12, 30),
    });
    vi.mocked(exifr.gps).mockResolvedValue({ latitude: 41.1496, longitude: -8.6109 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          features: [{ properties: { geocoding: { city: "Porto" } } }],
        }),
      })) as unknown as typeof fetch,
    );

    const root = path.join(process.cwd(), ".tmp-tests", task.id);
    const input = path.join(root, "input");
    const output = path.join(root, "trips");
    const dayDirectory = path.join(output, "rome", "days", "2026-05-14");
    const cachePath = path.join(root, "cache.json");
    await mkdir(input, { recursive: true });
    await mkdir(dayDirectory, { recursive: true });
    await writeFile(path.join(input, "a.jpg"), "source");
    await writeFile(path.join(dayDirectory, "meta.yaml"), "locations: []\nhighlights: []\n");

    await sortPhotos({
      input,
      trip: "rome",
      contentRoot: output,
      dryRun: true,
      geocodeCachePath: cachePath,
      geocodeDelayMs: 0,
    });

    expect(await readFile(path.join(dayDirectory, "meta.yaml"), "utf8")).toBe("locations: []\nhighlights: []\n");
    await expect(stat(cachePath)).rejects.toThrow();
  });

  it("uses persistent geocode cache entries without fetching again", async ({ task }) => {
    vi.mocked(exifr.parse).mockResolvedValue({
      DateTimeOriginal: new Date(2026, 4, 14, 12, 30),
    });
    vi.mocked(exifr.gps).mockResolvedValue({ latitude: 41.1496, longitude: -8.6109 });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const root = path.join(process.cwd(), ".tmp-tests", task.id);
    const input = path.join(root, "input");
    const output = path.join(root, "trips");
    const cachePath = path.join(root, "cache.json");
    await mkdir(input, { recursive: true });
    await writeFile(path.join(input, "a.jpg"), "source");
    await writeFile(cachePath, JSON.stringify({ "41.150,-8.611": "Porto" }));

    const result = await planPhotoSort({
      input,
      trip: "rome",
      contentRoot: output,
      dryRun: true,
      geocodeCachePath: cachePath,
      geocodeDelayMs: 0,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.metadataOperations[0].locations).toEqual(["Porto"]);
  });
});
