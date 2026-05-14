/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

declare module "*.md" {
  const frontmatter: Record<string, unknown>;
  const Content: import("astro").MarkdownInstance<Record<string, unknown>>["Content"];
  export { Content, frontmatter };
}
