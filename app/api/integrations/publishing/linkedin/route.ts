export const runtime = "nodejs";

export async function POST() {
  return Response.json({
    error: "linkedin_publishing_is_lupe_managed",
    message: "OCC does not publish to LinkedIn. Lupe must claim an approved item through its OCC LinkedIn publication endpoint.",
  }, { status: 410 });
}
