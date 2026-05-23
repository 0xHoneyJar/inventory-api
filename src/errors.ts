export class FixtureLoadError extends Error {
  readonly code = "INVENTORY_FIXTURE_LOAD" as const;
  readonly filePath: string;
  readonly cause: unknown;

  constructor(filePath: string, cause: unknown) {
    super(`Failed to load fixture: ${filePath}`);
    this.name = "FixtureLoadError";
    this.filePath = filePath;
    this.cause = cause;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, FixtureLoadError);
    }
  }
}

export class ValidationError extends Error {
  readonly code = "INVENTORY_INVALID_INPUT" as const;
  readonly field: string;
  readonly value: unknown;
  readonly expected: string;

  constructor(field: string, value: unknown, expected: string) {
    super(`Invalid ${field}: expected ${expected}, got ${String(value)}`);
    this.name = "ValidationError";
    this.field = field;
    this.value = value;
    this.expected = expected;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ValidationError);
    }
  }
}

export class NotFoundError extends Error {
  readonly code = "INVENTORY_NOT_FOUND" as const;
  readonly tokenId: string;
  readonly contract: string;

  constructor(tokenId: string, contract: string) {
    super(`Token ${tokenId} not found in contract ${contract}`);
    this.name = "NotFoundError";
    this.tokenId = tokenId;
    this.contract = contract;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, NotFoundError);
    }
  }
}
