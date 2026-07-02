/**
 * Controls whether live sonar failures may fall back to hermetic fixtures.
 *
 * Fixtures are realistic test doubles — using them as a production fallback
 * would serve synthetic ownership rows as if they were real belt data.
 */
export function shouldUseSonarFixtureFallback(): boolean {
  if (process.env.SONAR_FIXTURE_FALLBACK === "1") return true;
  return process.env.NODE_ENV !== "production";
}

export function warnSonarLiveEmpty(context: string, err: unknown): void {
  console.warn(
    `[inventory-api] sonar live ${context} unavailable; returning empty holdings`,
    err instanceof Error ? err.message : err
  );
}
