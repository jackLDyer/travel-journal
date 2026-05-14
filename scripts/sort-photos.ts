import path from "node:path";
import { sortPhotos } from "./photo-sorter";

type CliOptions = {
  input?: string;
  trip?: string;
  contentRoot?: string;
  move?: boolean;
  dryRun?: boolean;
  help?: boolean;
};

function readOptions(argv: string[]): CliOptions {
  const options: CliOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--input") {
      options.input = next;
      index += 1;
    } else if (arg === "--trip") {
      options.trip = next;
      index += 1;
    } else if (arg === "--content-root") {
      options.contentRoot = next;
      index += 1;
    } else if (arg === "--move") {
      options.move = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Sort travel photos into day folders.

Usage:
  npm run sort-photos -- --input <folder> --trip <trip-slug> [--dry-run] [--move]

Options:
  --input <folder>       Folder containing photos to sort
  --trip <trip-slug>     Trip folder under src/content/trips
  --content-root <path>  Override the trips content root
  --dry-run              Print planned operations without copying or moving
  --move                 Move files instead of copying them
`);
}

function printResult(result: Awaited<ReturnType<typeof sortPhotos>>, dryRun: boolean) {
  const verb = dryRun ? "Planned" : "Completed";
  console.log(`${verb} ${result.operations.length} photo operation(s).`);

  for (const operation of result.operations) {
    const action = dryRun ? operation.action.toUpperCase() : `${operation.action.toUpperCase()}ED`;
    console.log(`${action}: ${operation.source} -> ${operation.destination}`);
  }

  if (result.counts.size > 0) {
    console.log("\nSummary:");
    for (const [day, count] of [...result.counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(`  ${day}: ${count}`);
    }
  }
}

async function main() {
  const options = readOptions(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  if (!options.input || !options.trip) {
    printHelp();
    throw new Error("--input and --trip are required");
  }

  const result = await sortPhotos({
    input: path.resolve(options.input),
    trip: options.trip,
    contentRoot: options.contentRoot,
    move: options.move,
    dryRun: options.dryRun,
  });

  printResult(result, Boolean(options.dryRun));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
