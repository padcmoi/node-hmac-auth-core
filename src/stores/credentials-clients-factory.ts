import { randomBytes } from "node:crypto";
import { hashClientSecret } from "../core/crypto.js";
import { HmacAuthError } from "../core/errors.js";
import { normalizeAllowedIpRules } from "../core/ip.js";
import type {
  CreateHmacClientOptions,
  HmacClientCredential,
  HmacClientCredentialWithSecret,
  HmacCredentialRevertResult,
  RegenerateHmacSecretOptions,
} from "../core/types.js";
import { type RedisCredentialStore, type StoredClientCredentialRecord } from "./redis.js";

/**
 * Shared credentials-store clients factory.
 *
 * Builds the `clients` object exposed by both `initializeHmacHttpAuth` and
 * `initializeHmacMessageAuth`. Both stores share the exact same credential
 * lifecycle (create / regenerate / setSecret / setSecretHash / setAllowedIps /
 * get / list / delete / revert) on top of an underlying `RedisCredentialStore`;
 * only the Redis namespace and the `secretToken` differ.
 *
 * `secretToken` is the optional `HMAC_SECRET_TOKEN` propagated to
 * `hashClientSecret`. `dbSeedBackupTtlSeconds` controls the TTL of the
 * backup key written before every `setSecret` / `setSecretHash` that actually
 * changes the stored hash; it is the window in which `clients.revert(clientId)`
 * can restore the previous secretHash.
 */
export interface CreateCredentialsClientsFactoryDeps {
  credentialStore: RedisCredentialStore;
  secretToken: string | undefined;
  defaultSecretLengthBytes: number;
  dbSeedBackupTtlSeconds: number;
}

export interface HmacCredentialsStoreClients {
  create: (options: CreateHmacClientOptions) => Promise<HmacClientCredentialWithSecret>;
  listClientIds: () => Promise<string[]>;
  get: (clientId: string) => Promise<HmacClientCredential | null>;
  delete: (clientId: string) => Promise<void>;
  regenerateSecret: (clientId: string, options?: RegenerateHmacSecretOptions) => Promise<HmacClientCredentialWithSecret>;
  setSecret: (clientId: string, secret: string, expiresAt?: number | Date | null, allowedIps?: string[]) => Promise<void>;
  setSecretHash: (clientId: string, secretHash: string, expiresAt?: number | Date | null, allowedIps?: string[]) => Promise<void>;
  setAllowedIps: (clientId: string, allowedIps: string[]) => Promise<void>;
  getSecretHash: (clientId: string) => Promise<string | null>;
  revert: (clientId: string) => Promise<HmacCredentialRevertResult>;
}

function assertClientId(clientId: string): void {
  if (!clientId || !clientId.trim()) {
    throw new HmacAuthError("MISSING_CLIENT_ID", "clientId cannot be empty", 400);
  }
}

function assertPlainSecret(secret: string): void {
  if (!secret || !secret.trim()) {
    throw new Error("plainSecret cannot be empty");
  }
}

function assertSecretLength(secretLengthBytes: number): void {
  if (!Number.isInteger(secretLengthBytes) || secretLengthBytes < 16 || secretLengthBytes > 128) {
    throw new Error("secretLengthBytes must be an integer between 16 and 128");
  }
}

function generateSecret(secretLengthBytes: number): string {
  assertSecretLength(secretLengthBytes);
  return randomBytes(secretLengthBytes).toString("hex");
}

function normalizeSecretHash(secretHash: string): string {
  return secretHash.trim().toLowerCase();
}

function normalizeExpiresAt(value?: number | Date | null): number | null {
  if (value == null) {
    return null;
  }

  const expiresAt = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(expiresAt)) {
    throw new Error("expiresAt must be a valid timestamp or Date");
  }
  return expiresAt;
}

function mapCredential(clientId: string, record: StoredClientCredentialRecord): HmacClientCredential {
  return {
    clientId,
    secretHash: record.secretHash,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAt,
    allowedIps: record.allowedIps,
  };
}

export function createCredentialsClientsFactory(deps: CreateCredentialsClientsFactoryDeps): HmacCredentialsStoreClients {
  const { credentialStore, secretToken, defaultSecretLengthBytes, dbSeedBackupTtlSeconds } = deps;

  return {
    create: async (createOptions) => {
      assertClientId(createOptions.clientId);
      let secret: string;
      if (createOptions.plainSecret !== undefined) {
        assertPlainSecret(createOptions.plainSecret);
        secret = createOptions.plainSecret;
      } else {
        secret = generateSecret(createOptions.secretLengthBytes ?? defaultSecretLengthBytes);
      }
      const secretHash = hashClientSecret(secret, secretToken);
      const now = Date.now();
      const record: StoredClientCredentialRecord = {
        secretHash,
        createdAt: now,
        updatedAt: now,
        expiresAt: normalizeExpiresAt(createOptions.expiresAt),
        allowedIps: normalizeAllowedIpRules(createOptions.allowedIps),
      };

      await credentialStore.setClientRecord(createOptions.clientId, record);

      return {
        ...mapCredential(createOptions.clientId, record),
        secret,
      };
    },

    listClientIds: async () => credentialStore.listClientIds(),

    get: async (clientId) => {
      assertClientId(clientId);
      const record = await credentialStore.getClientRecord(clientId);
      if (!record) {
        return null;
      }
      return mapCredential(clientId, record);
    },

    delete: async (clientId) => {
      assertClientId(clientId);
      await credentialStore.deleteClient(clientId);
    },

    regenerateSecret: async (clientId, regenerateOptions) => {
      assertClientId(clientId);
      const existing = await credentialStore.getClientRecord(clientId);
      if (!existing) {
        throw new HmacAuthError("CLIENT_NOT_FOUND", "Cannot regenerate secret: client not found", 404);
      }

      let secret: string;
      if (regenerateOptions?.plainSecret !== undefined) {
        assertPlainSecret(regenerateOptions.plainSecret);
        secret = regenerateOptions.plainSecret;
      } else {
        const secretLength = regenerateOptions?.secretLengthBytes ?? defaultSecretLengthBytes;
        secret = generateSecret(secretLength);
      }

      const now = Date.now();
      const expiresAt =
        regenerateOptions?.expiresAt !== undefined
          ? normalizeExpiresAt(regenerateOptions.expiresAt)
          : regenerateOptions?.preserveExpiresAt === false
            ? null
            : existing.expiresAt;

      const newSecretHash = hashClientSecret(secret, secretToken);
      if (existing.secretHash !== newSecretHash) {
        await credentialStore.setBackupSecretHash(clientId, existing.secretHash, dbSeedBackupTtlSeconds);
      }

      const updatedRecord: StoredClientCredentialRecord = {
        secretHash: newSecretHash,
        createdAt: existing.createdAt || now,
        updatedAt: now,
        expiresAt,
        allowedIps:
          regenerateOptions?.allowedIps !== undefined
            ? normalizeAllowedIpRules(regenerateOptions.allowedIps)
            : existing.allowedIps,
      };

      await credentialStore.setClientRecord(clientId, updatedRecord);
      return {
        ...mapCredential(clientId, updatedRecord),
        secret,
      };
    },

    setSecret: async (clientId, secret, expiresAt, allowedIps) => {
      assertClientId(clientId);
      const now = Date.now();
      const existing = await credentialStore.getClientRecord(clientId);
      const newSecretHash = hashClientSecret(secret, secretToken);
      // Whenever the stored hash actually changes, write a TTL backup of the
      // previous hash so `clients.revert(clientId)` can roll back within the
      // dbSeedBackupTtlSeconds window.
      if (existing && existing.secretHash !== newSecretHash) {
        await credentialStore.setBackupSecretHash(clientId, existing.secretHash, dbSeedBackupTtlSeconds);
      }
      const record: StoredClientCredentialRecord = {
        secretHash: newSecretHash,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        expiresAt: expiresAt === undefined ? (existing?.expiresAt ?? null) : normalizeExpiresAt(expiresAt),
        allowedIps: allowedIps === undefined ? (existing?.allowedIps ?? []) : normalizeAllowedIpRules(allowedIps),
      };
      await credentialStore.setClientRecord(clientId, record);
    },

    setSecretHash: async (clientId, secretHash, expiresAt, allowedIps) => {
      assertClientId(clientId);
      const now = Date.now();
      const existing = await credentialStore.getClientRecord(clientId);
      const normalizedHash = normalizeSecretHash(secretHash);
      if (existing && existing.secretHash !== normalizedHash) {
        await credentialStore.setBackupSecretHash(clientId, existing.secretHash, dbSeedBackupTtlSeconds);
      }
      const record: StoredClientCredentialRecord = {
        secretHash: normalizedHash,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        expiresAt: expiresAt === undefined ? (existing?.expiresAt ?? null) : normalizeExpiresAt(expiresAt),
        allowedIps: allowedIps === undefined ? (existing?.allowedIps ?? []) : normalizeAllowedIpRules(allowedIps),
      };
      await credentialStore.setClientRecord(clientId, record);
    },

    setAllowedIps: async (clientId, allowedIps) => {
      assertClientId(clientId);
      const now = Date.now();
      const existing = await credentialStore.getClientRecord(clientId);
      if (!existing) {
        throw new HmacAuthError("CLIENT_NOT_FOUND", "Cannot set allowedIps: client not found", 404);
      }

      const record: StoredClientCredentialRecord = {
        secretHash: existing.secretHash,
        createdAt: existing.createdAt || now,
        updatedAt: now,
        expiresAt: existing.expiresAt ?? null,
        allowedIps: normalizeAllowedIpRules(allowedIps),
      };

      await credentialStore.setClientRecord(clientId, record);
    },

    getSecretHash: async (clientId) => {
      assertClientId(clientId);
      return credentialStore.getSecretHash(clientId);
    },

    revert: async (clientId) => {
      assertClientId(clientId);
      const backupHash = await credentialStore.getBackupSecretHash(clientId);
      if (!backupHash) {
        return { reverted: false };
      }
      const existing = await credentialStore.getClientRecord(clientId);
      if (!existing) {
        // The credential disappeared while a backup was alive; drop the
        // orphan backup to avoid surprising future rollbacks and report no-op.
        await credentialStore.clearBackupSecretHash(clientId);
        return { reverted: false };
      }
      const now = Date.now();
      const record: StoredClientCredentialRecord = {
        secretHash: backupHash,
        createdAt: existing.createdAt || now,
        updatedAt: now,
        expiresAt: existing.expiresAt ?? null,
        allowedIps: existing.allowedIps,
      };
      await credentialStore.setClientRecord(clientId, record);
      await credentialStore.clearBackupSecretHash(clientId);
      return { reverted: true, restoredSecretHash: backupHash };
    },
  };
}
