import { timingSafeEqual } from "node:crypto";

export function hasWebhookBearer(request: Request, expected?: string) {
  const configured = expected?.trim() || "";
  const authorization = request.headers.get("authorization") || "";
  const supplied = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  if (!configured || !supplied) return false;
  const configuredBytes = Buffer.from(configured);
  const suppliedBytes = Buffer.from(supplied);
  return (
    configuredBytes.length === suppliedBytes.length &&
    timingSafeEqual(configuredBytes, suppliedBytes)
  );
}
