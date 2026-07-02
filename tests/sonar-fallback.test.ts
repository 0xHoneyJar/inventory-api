import { describe, it, expect, afterEach, vi } from "vitest";
import { shouldUseSonarFixtureFallback } from "../src/sonar-fallback.js";

describe("shouldUseSonarFixtureFallback", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows fixture fallback in non-production by default", () => {
    vi.stubEnv("NODE_ENV", "test");
    delete process.env.SONAR_FIXTURE_FALLBACK;
    expect(shouldUseSonarFixtureFallback()).toBe(true);
  });

  it("disallows fixture fallback in production unless explicitly enabled", () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.SONAR_FIXTURE_FALLBACK;
    expect(shouldUseSonarFixtureFallback()).toBe(false);
  });

  it("allows fixture fallback in production when SONAR_FIXTURE_FALLBACK=1", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SONAR_FIXTURE_FALLBACK", "1");
    expect(shouldUseSonarFixtureFallback()).toBe(true);
  });
});
