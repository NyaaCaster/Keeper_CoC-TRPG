/**
 * Runtime configuration that the server publishes to the SPA via
 * GET /api/public-config. The value is cached at module level after the
 * first successful fetch (called from main.tsx before React renders).
 *
 * The image-public-prefix is the allowlist that gates which imageUrl values
 * are allowed into localStorage — anything that doesn't start with this
 * prefix is dropped before being persisted, so legacy base64 / third-party
 * URLs cannot pollute saves.
 */

interface PublicConfig {
  imagePublicBaseUrl: string;
  imagePublicPrefix: string;
}

let cached: PublicConfig | null = null;

export async function loadPublicConfig(): Promise<PublicConfig> {
  const r = await fetch("/api/public-config");
  if (!r.ok) throw new Error(`/api/public-config returned ${r.status}`);
  const data = await r.json();
  const base = String(data?.imagePublicBaseUrl || "").replace(/\/+$/, "");
  cached = {
    imagePublicBaseUrl: base,
    imagePublicPrefix: base ? `${base}/` : "",
  };
  return cached;
}

export function getImagePublicPrefix(): string {
  return cached?.imagePublicPrefix ?? "";
}

export function getImagePublicBaseUrl(): string {
  return cached?.imagePublicBaseUrl ?? "";
}
