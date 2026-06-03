import { randomBytes } from "node:crypto";
import { HmacAuthError } from "../core/errors.js";
import type { HmacClientCredential } from "../core/types.js";
import type { StoredClientCredentialRecord } from "../stores/redis.js";

/**
 * Shared helpers used across the HTTP store factory and the verify path.
 * Kept private to `src/http/*` so the public package surface
 * (`src/index.ts`) does not expand.
 */

export function assertClientId(clientId: string): void {
  if (!clientId || !clientId.trim()) {
    throw new HmacAuthError("MISSING_CLIENT_ID", "clientId cannot be empty", 400);
  }
}

export function normalizeSecretHash(secretHash: string): string {
  return secretHash.trim().toLowerCase();
}

export function normalizeExpiresAt(value?: number | Date | null): number | null {
  if (value == null) {
    return null;
  }

  const expiresAt = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(expiresAt)) {
    throw new Error("expiresAt must be a valid timestamp or Date");
  }
  return expiresAt;
}

export function assertSecretLength(secretLengthBytes: number): void {
  if (!Number.isInteger(secretLengthBytes) || secretLengthBytes < 16 || secretLengthBytes > 128) {
    throw new Error("secretLengthBytes must be an integer between 16 and 128");
  }
}

export function assertPlainSecret(secret: string): void {
  if (!secret || !secret.trim()) {
    throw new Error("plainSecret cannot be empty");
  }
}

export function mapCredential(clientId: string, record: StoredClientCredentialRecord): HmacClientCredential {
  return {
    clientId,
    secretHash: record.secretHash,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAt,
    allowedIps: record.allowedIps,
  };
}

export function generateSecret(secretLengthBytes: number): string {
  assertSecretLength(secretLengthBytes);
  return randomBytes(secretLengthBytes).toString("hex");
}

export function toHmacError(error: unknown): HmacAuthError {
  if (error instanceof HmacAuthError) {
    return error;
  }

  if (error instanceof Error) {
    return new HmacAuthError("INTERNAL_ERROR", error.message, 500);
  }

  return new HmacAuthError("INTERNAL_ERROR", "Internal auth error", 500);
}
