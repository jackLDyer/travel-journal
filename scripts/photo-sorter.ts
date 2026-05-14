import { copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import exifr from "exifr";
import sharp from "sharp";
import { parseDocument } from "yaml";

const DEFAULT_OPTIMIZED_MAX_DIMENSION = 1600;
const DEFAULT_OPTIMIZED_QUALITY = 76;
const DEFAULT_GEOCODE_DELAY_MS = 1000;
const GEOCODE_USER_AGENT = "travel-journal-photo-sorter/0.1";
const SUMMARY_PLACEHOLDER = `Write the day's story here.
`;
const TRIP_SUMMARY_PLACEHOLDER = `Write the trip summary here.
`;
const META_PLACEHOLDER = `locations: []
highlights: []
`;
const TRIP_META_PLACEHOLDER = `coverPhoto: ""
`;

export const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
]);

export type SortPhotosOptions = {
  input: string;
  trip: string;
  contentRoot?: string;
  move?: boolean;
  dryRun?: boolean;
  optimize?: boolean;
  maxDimension?: number;
  quality?: number;
  enrichLocations?: boolean;
  geocodeCachePath?: string;
  geocodeDelayMs?: number;
  log?: (message: string) => void;
};

export type PlannedOperation = {
  source: string;
  destination: string;
  day: string | "unsorted";
  action: "copy" | "move" | "optimize";
};

export type ScaffoldOperation = {
  destination: string;
  day?: string;
  filename: "summary.md" | "meta.yaml";
  content: string;
};

export type MetadataOperation = {
  destination: string;
  day: string;
  existingLocations: string[];
  detectedLocations: string[];
  locations: string[];
  content: string;
};

export type SortPhotosResult = {
  operations: PlannedOperation[];
  scaffoldOperations: ScaffoldOperation[];
  metadataOperations: MetadataOperation[];
  skipped: string[];
  counts: Map<string, number>;
  geocodeCacheUpdates: number;
};

type ExifDateFields = {
  DateTimeOriginal?: Date | string;
  CreateDate?: Date | string;
  DateTimeDigitized?: Date | string;
};

type GpsCoordinates = {
  latitude: number;
  longitude: number;
};

type GeocodeCache = Record<string, string | null>;

type GeocodeCacheState = {
  path: string;
  entries: GeocodeCache;
  updates: number;
};

type CoordinateBucket = {
  coordinates: GpsCoordinates;
  count: number;
  firstSeen: number;
};

type LocationScore = {
  name: string;
  count: number;
  firstSeen: number;
};

type GeocodeJsonResponse = {
  features?:
    | {
        properties?: {
          geocoding?: Record<string, unknown>;
        };
      }[]
    | {
        properties?: {
          geocoding?: Record<string, unknown>;
        };
      };
};

type LocationLogger = ((message: string) => void) | undefined;

export function isSupportedImage(filePath: string) {
  return SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function formatDay(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getDestinationDirectory(contentRoot: string, trip: string, day: string | null) {
  if (day === null) {
    return path.join(contentRoot, trip, "days", "unsorted");
  }

  return path.join(contentRoot, trip, "days", day, "photos");
}

export function getDayDirectory(contentRoot: string, trip: string, day: string) {
  return path.join(contentRoot, trip, "days", day);
}

export function getOptimizedFilename(filename: string) {
  return `${path.parse(filename).name}.webp`;
}

export function parseExifDate(value: Date | string | undefined) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function getTakenDate(filePath: string) {
  try {
    const metadata = (await exifr.parse(filePath, [
      "DateTimeOriginal",
      "CreateDate",
      "DateTimeDigitized",
    ])) as ExifDateFields | undefined;

    return (
      parseExifDate(metadata?.DateTimeOriginal) ??
      parseExifDate(metadata?.CreateDate) ??
      parseExifDate(metadata?.DateTimeDigitized)
    );
  } catch {
    return null;
  }
}

export async function getGpsCoordinates(filePath: string): Promise<GpsCoordinates | null> {
  try {
    const gps = (await exifr.gps(filePath)) as GpsCoordinates | undefined;
    if (
      gps &&
      Number.isFinite(gps.latitude) &&
      Number.isFinite(gps.longitude) &&
      Math.abs(gps.latitude) <= 90 &&
      Math.abs(gps.longitude) <= 180
    ) {
      return gps;
    }
  } catch {
    return null;
  }

  return null;
}

export async function listImageFiles(input: string): Promise<string[]> {
  const entries = await readdir(input, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(input, entry.name);
      if (entry.isDirectory()) {
        return listImageFiles(fullPath);
      }

      return isSupportedImage(fullPath) ? [fullPath] : [];
    }),
  );

  return files.flat().sort((a, b) => a.localeCompare(b));
}

function normalizeLocationName(location: string) {
  return location.trim().replace(/\s+/g, " ");
}

function locationKey(location: string) {
  return normalizeLocationName(location).toLocaleLowerCase("en-GB");
}

function cleanLocationName(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = normalizeLocationName(value.replace(/\s*\([^)]*\)\s*$/, ""));
  return normalized.length > 0 ? normalized : null;
}

function asStringList(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((item) => cleanLocationName(item))
        .filter((item): item is string => item !== null)
    : [];
}

function getGeocodeFeatures(response: GeocodeJsonResponse) {
  if (Array.isArray(response.features)) {
    return response.features;
  }

  return response.features ? [response.features] : [];
}

function extractLocationName(response: GeocodeJsonResponse) {
  const geocoding = getGeocodeFeatures(response)[0]?.properties?.geocoding;
  if (!geocoding) {
    return null;
  }

  const settlement = [
    "city",
    "town",
    "village",
    "municipality",
    "locality",
  ]
    .map((key) => cleanLocationName(geocoding[key]))
    .find((value): value is string => value !== null);

  if (settlement) {
    return settlement;
  }

  const admin = geocoding.admin;
  if (admin && typeof admin === "object") {
    const adminRecord = admin as Record<string, unknown>;
    const adminLocation = ["level8", "level7", "level6", "level5", "level4"]
      .map((key) => cleanLocationName(adminRecord[key]))
      .find((value): value is string => value !== null);
    if (adminLocation) {
      return adminLocation;
    }
  }

  return ["county", "region", "state"]
    .map((key) => cleanLocationName(geocoding[key]))
    .find((value): value is string => value !== null) ?? null;
}

function getCoordinateKey(coordinates: GpsCoordinates) {
  return `${coordinates.latitude.toFixed(3)},${coordinates.longitude.toFixed(3)}`;
}

function getDefaultGeocodeCachePath() {
  return path.resolve(".cache", "photo-geocode-cache.json");
}

function logLocation(logger: LocationLogger, message: string) {
  logger?.(`[locations] ${message}`);
}

async function loadGeocodeCache(cachePath: string): Promise<GeocodeCacheState> {
  try {
    const raw = await readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const entries: GeocodeCache = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "string" || value === null) {
          entries[key] = value;
        }
      }
      return { path: cachePath, entries, updates: 0 };
    }
  } catch {
    // Missing or invalid caches are rebuilt lazily.
  }

  return { path: cachePath, entries: {}, updates: 0 };
}

async function saveGeocodeCache(cache: GeocodeCacheState) {
  if (cache.updates === 0) {
    return;
  }

  const sortedEntries = Object.fromEntries(
    Object.entries(cache.entries).sort((a, b) => a[0].localeCompare(b[0])),
  );
  await mkdir(path.dirname(cache.path), { recursive: true });
  await writeFile(cache.path, `${JSON.stringify(sortedEntries, null, 2)}\n`);
}

async function wait(milliseconds: number) {
  if (milliseconds > 0) {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}

async function reverseGeocode(
  coordinates: GpsCoordinates,
  cache: GeocodeCacheState,
  delayMs: number,
  lastRequest: { at: number | null },
  logger: LocationLogger,
) {
  const key = getCoordinateKey(coordinates);
  if (Object.hasOwn(cache.entries, key)) {
    logLocation(logger, `${key}: cache ${cache.entries[key] ?? "no location"}`);
    return cache.entries[key];
  }

  if (lastRequest.at !== null) {
    const elapsed = Date.now() - lastRequest.at;
    await wait(Math.max(0, delayMs - elapsed));
  }

  lastRequest.at = Date.now();
  logLocation(logger, `${key}: reverse geocoding`);

  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "geocodejson");
    url.searchParams.set("lat", String(coordinates.latitude));
    url.searchParams.set("lon", String(coordinates.longitude));
    url.searchParams.set("zoom", "10");
    url.searchParams.set("layer", "address");

    const response = await fetch(url, {
      headers: {
        "User-Agent": GEOCODE_USER_AGENT,
        "Accept-Language": "en",
      },
    });
    if (!response.ok) {
      logLocation(logger, `${key}: geocode failed with HTTP ${response.status}`);
      return null;
    }

    const location = extractLocationName((await response.json()) as GeocodeJsonResponse);
    cache.entries[key] = location;
    cache.updates += 1;
    logLocation(logger, `${key}: ${location ?? "no coarse location found"}`);
    return location;
  } catch {
    logLocation(logger, `${key}: geocode failed`);
    return null;
  }
}

function rankDetectedLocations(scores: Map<string, LocationScore>) {
  return [...scores.values()]
    .sort((a, b) => b.count - a.count || a.firstSeen - b.firstSeen || a.name.localeCompare(b.name))
    .map((score) => score.name)
    .slice(0, 3);
}

async function readDayMetaDocument(filePath: string) {
  let raw = META_PLACEHOLDER;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    // New day metadata is based on the same placeholder the importer scaffolds.
  }

  const document = parseDocument(raw.length > 0 ? raw : META_PLACEHOLDER);
  if (document.errors.length > 0) {
    return parseDocument(META_PLACEHOLDER);
  }

  return document;
}

async function planLocationMetadataUpdate(
  contentRoot: string,
  trip: string,
  day: string,
  detectedLocations: string[],
) {
  const destination = path.join(getDayDirectory(contentRoot, trip, day), "meta.yaml");
  const document = await readDayMetaDocument(destination);
  const existingLocations = asStringList(document.toJS()?.locations);
  const mergedLocations: string[] = [];
  const seen = new Set<string>();

  for (const location of [...existingLocations, ...detectedLocations]) {
    const normalized = normalizeLocationName(location);
    const key = locationKey(normalized);
    if (!seen.has(key)) {
      seen.add(key);
      mergedLocations.push(normalized);
    }
    if (mergedLocations.length >= 3) {
      break;
    }
  }

  const existingKey = existingLocations.map(locationKey).join("\0");
  const mergedKey = mergedLocations.map(locationKey).join("\0");
  if (existingKey === mergedKey) {
    return null;
  }

  document.set("locations", mergedLocations);

  return {
    destination,
    day,
    existingLocations,
    detectedLocations,
    locations: mergedLocations,
    content: document.toString({ lineWidth: 0 }),
  } satisfies MetadataOperation;
}

async function planLocationMetadataUpdates(
  contentRoot: string,
  trip: string,
  coordinatesByDay: Map<string, Map<string, CoordinateBucket>>,
  cache: GeocodeCacheState,
  delayMs: number,
  logger: LocationLogger,
) {
  const metadataOperations: MetadataOperation[] = [];
  const lastRequest = { at: null as number | null };

  for (const [day, coordinateBuckets] of [...coordinatesByDay.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const scores = new Map<string, LocationScore>();
    const photoCount = [...coordinateBuckets.values()].reduce((total, bucket) => total + bucket.count, 0);
    logLocation(
      logger,
      `${day}: resolving ${coordinateBuckets.size} coordinate bucket(s) from ${photoCount} photo(s)`,
    );
    for (const bucket of [...coordinateBuckets.values()].sort((a, b) => a.firstSeen - b.firstSeen)) {
      const location = await reverseGeocode(
        bucket.coordinates,
        cache,
        delayMs,
        lastRequest,
        logger,
      );
      if (!location) {
        continue;
      }

      const normalized = normalizeLocationName(location);
      const key = locationKey(normalized);
      const existing = scores.get(key);
      if (existing) {
        existing.count += bucket.count;
      } else {
        scores.set(key, {
          name: normalized,
          count: bucket.count,
          firstSeen: bucket.firstSeen,
        });
      }
    }

    const detectedLocations = rankDetectedLocations(scores);
    logLocation(
      logger,
      `${day}: detected ${detectedLocations.length > 0 ? detectedLocations.join(", ") : "no locations"}`,
    );
    const operation = await planLocationMetadataUpdate(
      contentRoot,
      trip,
      day,
      detectedLocations,
    );
    if (operation) {
      logLocation(logger, `${day}: planned locations ${operation.locations.join(", ") || "[]"}`);
      metadataOperations.push(operation);
    } else {
      logLocation(logger, `${day}: meta.yaml locations already up to date`);
    }
  }

  return metadataOperations;
}

export async function resolveAvailablePath(
  destinationDirectory: string,
  filename: string,
  reserved = new Set<string>(),
) {
  const parsed = path.parse(filename);
  let attempt = 1;

  while (true) {
    const suffix = attempt === 1 ? "" : `-${attempt}`;
    const candidate = path.join(destinationDirectory, `${parsed.name}${suffix}${parsed.ext}`);
    const key = path.resolve(candidate).toLowerCase();

    if (!reserved.has(key)) {
      try {
        await stat(candidate);
      } catch {
        reserved.add(key);
        return candidate;
      }
    }

    attempt += 1;
  }
}

async function fileExists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function planDayScaffolds(
  contentRoot: string,
  trip: string,
  days: Iterable<string>,
): Promise<ScaffoldOperation[]> {
  const scaffoldOperations: ScaffoldOperation[] = [];

  for (const day of [...new Set(days)].sort((a, b) => a.localeCompare(b))) {
    const dayDirectory = getDayDirectory(contentRoot, trip, day);
    const files = [
      {
        filename: "summary.md" as const,
        content: SUMMARY_PLACEHOLDER,
      },
      {
        filename: "meta.yaml" as const,
        content: META_PLACEHOLDER,
      },
    ];

    for (const file of files) {
      const destination = path.join(dayDirectory, file.filename);
      if (!(await fileExists(destination))) {
        scaffoldOperations.push({
          destination,
          day,
          filename: file.filename,
          content: file.content,
        });
      }
    }
  }

  return scaffoldOperations;
}

export async function planTripScaffolds(
  contentRoot: string,
  trip: string,
): Promise<ScaffoldOperation[]> {
  const tripDirectory = path.join(contentRoot, trip);
  const files = [
    {
      destination: path.join(tripDirectory, "summary.md"),
      filename: "summary.md" as const,
      content: TRIP_SUMMARY_PLACEHOLDER,
    },
    {
      destination: path.join(tripDirectory, "meta.yaml"),
      filename: "meta.yaml" as const,
      content: TRIP_META_PLACEHOLDER,
    },
  ];
  const scaffoldOperations: ScaffoldOperation[] = [];

  for (const file of files) {
    if (!(await fileExists(file.destination))) {
      scaffoldOperations.push(file);
    }
  }

  return scaffoldOperations;
}

export async function planPhotoSort(options: SortPhotosOptions): Promise<SortPhotosResult> {
  const input = path.resolve(options.input);
  const contentRoot = path.resolve(options.contentRoot ?? path.join("src", "content", "trips"));
  const imageFiles = await listImageFiles(input);
  const reserved = new Set<string>();
  const operations: PlannedOperation[] = [];
  const datedDays = new Set<string>();
  const skipped: string[] = [];
  const counts = new Map<string, number>();
  const coordinatesByDay = new Map<string, Map<string, CoordinateBucket>>();
  const enrichLocations = options.enrichLocations !== false;
  const logger = options.log;
  let firstSeenCoordinate = 0;

  for (const source of imageFiles) {
    const takenDate = await getTakenDate(source);
    const day = takenDate ? formatDay(takenDate) : "unsorted";
    if (takenDate) {
      datedDays.add(day);
      if (enrichLocations) {
        const coordinates = await getGpsCoordinates(source);
        if (coordinates) {
          const key = getCoordinateKey(coordinates);
          const dayCoordinates = coordinatesByDay.get(day) ?? new Map<string, CoordinateBucket>();
          const existing = dayCoordinates.get(key);
          if (existing) {
            existing.count += 1;
          } else {
            dayCoordinates.set(key, {
              coordinates,
              count: 1,
              firstSeen: firstSeenCoordinate,
            });
            firstSeenCoordinate += 1;
          }
          coordinatesByDay.set(day, dayCoordinates);
        }
      }
    }
    const destinationDirectory = getDestinationDirectory(
      contentRoot,
      options.trip,
      takenDate ? day : null,
    );
    const filename = options.optimize
      ? getOptimizedFilename(path.basename(source))
      : path.basename(source);
    const destination = path.join(destinationDirectory, filename);
    const key = path.resolve(destination).toLowerCase();

    if (reserved.has(key) || (await fileExists(destination))) {
      skipped.push(source);
      continue;
    }

    reserved.add(key);

    operations.push({
      source,
      destination,
      day,
      action: options.optimize ? "optimize" : options.move ? "move" : "copy",
    });
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }

  const scaffoldOperations = [
    ...(await planTripScaffolds(contentRoot, options.trip)),
    ...(await planDayScaffolds(contentRoot, options.trip, datedDays)),
  ];
  const cache = await loadGeocodeCache(
    path.resolve(options.geocodeCachePath ?? getDefaultGeocodeCachePath()),
  );
  if (enrichLocations) {
    const gpsPhotoCount = [...coordinatesByDay.values()].reduce(
      (total, buckets) =>
        total + [...buckets.values()].reduce((bucketTotal, bucket) => bucketTotal + bucket.count, 0),
      0,
    );
    logLocation(
      logger,
      gpsPhotoCount > 0
        ? `found GPS coordinates in ${gpsPhotoCount} dated photo(s) across ${coordinatesByDay.size} day(s)`
        : "no GPS coordinates found in dated photos",
    );
  } else {
    logLocation(logger, "location enrichment disabled");
  }
  const metadataOperations =
    enrichLocations && coordinatesByDay.size > 0
      ? await planLocationMetadataUpdates(
          contentRoot,
          options.trip,
          coordinatesByDay,
          cache,
          options.geocodeDelayMs ?? DEFAULT_GEOCODE_DELAY_MS,
          logger,
        )
      : [];

  return {
    operations,
    scaffoldOperations,
    metadataOperations,
    skipped,
    counts,
    geocodeCacheUpdates: cache.updates,
    ...(cache.updates > 0 ? { geocodeCache: cache } : {}),
  } as SortPhotosResult & { geocodeCache?: GeocodeCacheState };
}

export async function optimizePhoto(
  source: string,
  destination: string,
  maxDimension = DEFAULT_OPTIMIZED_MAX_DIMENSION,
  quality = DEFAULT_OPTIMIZED_QUALITY,
) {
  await sharp(source)
    .rotate()
    .resize({
      width: maxDimension,
      height: maxDimension,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality })
    .toFile(destination);
}

export async function sortPhotos(options: SortPhotosOptions) {
  const result = await planPhotoSort(options);

  if (!options.dryRun) {
    for (const operation of result.scaffoldOperations) {
      await mkdir(path.dirname(operation.destination), { recursive: true });
      try {
        await writeFile(operation.destination, operation.content, { flag: "wx" });
      } catch (error) {
        if (!isFileExistsError(error)) {
          throw error;
        }
      }
    }

    for (const operation of result.metadataOperations) {
      await mkdir(path.dirname(operation.destination), { recursive: true });
      await writeFile(operation.destination, operation.content);
    }

    const maybeResultWithCache = result as SortPhotosResult & { geocodeCache?: GeocodeCacheState };
    if (maybeResultWithCache.geocodeCache) {
      await saveGeocodeCache(maybeResultWithCache.geocodeCache);
    }

    for (const operation of result.operations) {
      await mkdir(path.dirname(operation.destination), { recursive: true });
      if (operation.action === "optimize") {
        await optimizePhoto(
          operation.source,
          operation.destination,
          options.maxDimension,
          options.quality,
        );
      } else if (operation.action === "move") {
        await rename(operation.source, operation.destination);
      } else {
        await copyFile(operation.source, operation.destination);
      }
    }
  }

  return result;
}

function isFileExistsError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  );
}
