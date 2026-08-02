export type PropertyLookup = (slug: string) => Promise<string | null>;

export type ContentPropertyScope =
  | { propertyId: string | null; error: null }
  | { propertyId: null; error: { code: "conflicting_property_scope" | "unknown_property"; message: string } };

export async function resolveContentPropertyScope(
  searchParams: URLSearchParams,
  lookupPropertyIdBySlug: PropertyLookup,
): Promise<ContentPropertyScope> {
  const explicitPropertyId = searchParams.get("property_id")?.trim() || null;
  const propertySlug = searchParams.get("property")?.trim() || null;
  const legacyBrandSlug = searchParams.get("brand")?.trim() || null;
  if (propertySlug && legacyBrandSlug && propertySlug !== legacyBrandSlug) {
    return { propertyId: null, error: { code: "conflicting_property_scope", message: "property and brand must identify the same OCC property." } };
  }
  const slug = propertySlug || legacyBrandSlug;
  if (!slug) return { propertyId: explicitPropertyId, error: null };
  const resolvedPropertyId = await lookupPropertyIdBySlug(slug);
  if (!resolvedPropertyId) {
    return { propertyId: null, error: { code: "unknown_property", message: `No OCC content property exists for slug '${slug}'.` } };
  }
  if (explicitPropertyId && explicitPropertyId !== resolvedPropertyId) {
    return { propertyId: null, error: { code: "conflicting_property_scope", message: "property_id does not match the requested OCC property slug." } };
  }
  return { propertyId: resolvedPropertyId, error: null };
}
