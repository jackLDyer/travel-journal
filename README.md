# Travel Journal

A static Astro site for travel journals, organised by trip and day folders. Each day can include a markdown summary and photos, and a local CLI can sort image files into day folders from their EXIF taken-date metadata.

## Content structure

```text
src/content/trips/<trip-slug>/
  trip.md
  days/
    YYYY-MM-DD/
      summary.md
      photos/
        image-1.jpg
    unsorted/
```

`trip.md` and `summary.md` can include optional frontmatter:

```md
---
title: A long weekend in Lisbon
description: Tiles, hills, and late dinners.
---

The written journal content goes here.
```

Day summaries can also use `location` in frontmatter.

## Commands

Requires Node.js `>=22.12.0`.

```bash
npm install
npm run dev
npm run build
npm run test
npm run sort-photos -- --input ./photo-dump --trip lisbon --dry-run
```

The sorter copies by default. Use `--move` only when you intentionally want to move originals out of the input folder. Files without reliable EXIF taken-date metadata are placed in `src/content/trips/<trip>/days/unsorted/`.
