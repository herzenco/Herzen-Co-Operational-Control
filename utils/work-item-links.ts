const DEFAULT_OCC_ORIGIN = "https://operations.herzenco.co";

export function workItemPath(id: string): string {
  return `/work-items/${encodeURIComponent(id)}`;
}

export function workItemUrl(id: string, origin = process.env.OCC_PUBLIC_URL || DEFAULT_OCC_ORIGIN): string {
  return new URL(workItemPath(id), origin).toString();
}
