/**
 * Link safety for anything the model or the dataset supplies.
 *
 * Only plain `http(s)` URLs may ever become an `href`. Anything else — scripts,
 * data URIs, `javascript:` payloads, relative paths, malformed strings — is
 * rejected, so no block can render an executable link.
 */
export function safeExternalHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.toString();
}
