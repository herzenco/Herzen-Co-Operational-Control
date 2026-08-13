const DEFAULT_OCC_ORIGIN = "https://operations.herzenco.co";

/** The stable browser route for one OCC content item. */
export function contentItemUrl(contentItemId: string, origin = process.env.OCC_PUBLIC_URL || DEFAULT_OCC_ORIGIN) {
  const url = new URL("/", origin);
  url.searchParams.set("content_item", contentItemId);
  return url.toString();
}
