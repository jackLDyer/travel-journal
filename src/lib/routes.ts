const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export function withBase(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${basePath}${normalizedPath}`;
}
