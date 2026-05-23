import { ValidationError } from "./errors.js";

export function encodePageKey(offset: number, total: number): string | undefined {
  if (offset >= total) return undefined;
  return btoa(JSON.stringify({ offset }));
}

export function decodePageKey(pageKey: string): { offset: number } {
  try {
    const decoded = JSON.parse(atob(pageKey)) as unknown;
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      !("offset" in decoded) ||
      typeof (decoded as { offset: unknown }).offset !== "number" ||
      !Number.isInteger((decoded as { offset: number }).offset) ||
      (decoded as { offset: number }).offset < 0
    ) {
      throw new Error("invalid structure");
    }
    return { offset: (decoded as { offset: number }).offset };
  } catch {
    throw new ValidationError("pageKey", pageKey, "base64-encoded JSON with non-negative integer offset");
  }
}

export function applyPagination<T>(
  items: T[],
  pageSize: number,
  pageKey?: string
): { page: T[]; nextPageKey: string | undefined } {
  const clampedSize = Math.max(1, Math.min(100, pageSize));
  const offset = pageKey ? decodePageKey(pageKey).offset : 0;
  const page = items.slice(offset, offset + clampedSize);
  const nextOffset = offset + clampedSize;
  const nextPageKey = encodePageKey(nextOffset, items.length);
  return { page, nextPageKey };
}
