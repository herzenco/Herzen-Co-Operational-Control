import { createHmac, timingSafeEqual } from "node:crypto";

export function hasValidMetaSignature(rawBody: string, signatureHeader: string | null, appSecret?: string) {
  const secret = appSecret?.trim() || "";
  const supplied = signatureHeader?.match(/^sha256=([a-f0-9]{64})$/i)?.[1]?.toLowerCase() || "";
  if (!secret || !supplied) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const expectedBytes = Buffer.from(expected, "hex");
  const suppliedBytes = Buffer.from(supplied, "hex");
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

export function hasMatchingSecret(supplied: string | null, expected?: string) {
  const suppliedBytes = Buffer.from(supplied || "", "utf8");
  const expectedBytes = Buffer.from(expected?.trim() || "", "utf8");
  return suppliedBytes.length > 0 && suppliedBytes.length === expectedBytes.length
    && timingSafeEqual(suppliedBytes, expectedBytes);
}
