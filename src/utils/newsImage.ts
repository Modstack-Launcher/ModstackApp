/** Turns a news image reference into an absolute URL, or `null` when there is none. */
export function resolveNewsImageUrl(image?: string | null, base?: string): string | null {
  const value = image?.trim();
  if (!value) return null;
  if (/^(https?:|data:|blob:)/i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  return base ? `${base.replace(/\/$/, "")}/${value.replace(/^\//, "")}` : null;
}
