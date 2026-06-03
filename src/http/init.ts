import type { HmacAuthError } from "../core/errors.js";
import type {
  CreateHmacClientOptions,
  HmacClientCredential,
  HmacClientCredentialWithSecret,
  HmacCredentialRevertResult,
  InitializeHmacHttpAuthOptions,
  OnBadHttpSignature,
  RegenerateHmacSecretOptions,
  VerifiedHttpRequest,
  VerifyHttpWithRedisInput,
} from "../core/types.js";
import { createCredentialsClientsFactory } from "../stores/credentials-clients-factory.js";
import { RedisCredentialStore, assertRedisClient, resolveNamespace, type RedisLikeClient } from "../stores/redis.js";
import {
  createHttpSignedFetchClient,
  type CreateHttpSignedFetchClientOptions,
  type SignedHttpFetchClientCallOptions,
} from "./client/signed-fetch.js";
import { DEFAULT_DB_SEED_BACKUP_TTL_SECONDS, DEFAULT_MAX_SKEW_MS, DEFAULT_SECRET_LENGTH_BYTES } from "./constants.js";
import { assertSecretLength } from "./internal-helpers.js";
import { createHttpMiddlewareFactory } from "./middlewares.js";
import { verifyHttpSignature as verifyHttpSignatureCore } from "./server/verify.js";

export interface InitializedHmacHttpAuth {
  readonly redis: RedisLikeClient;
  readonly namespace: string;
  readonly maxSkewMs: number;
  readonly secretToken?: string;
  verifyHttpRequest: (req: any, res: any, next: (error?: unknown) => void) => Promise<void>;
  verifyHttpSignature: (input: VerifyHttpWithRedisInput) => Promise<VerifiedHttpRequest>;
  createHttpMiddleware: (options?: {
    attachAuthTo?: string;
    maxSkewMs?: number;
    onError?: (error: HmacAuthError, req: any, res: any, next: (error?: unknown) => void) => void;
    onBadSignature?: OnBadHttpSignature;
  }) => (req: any, res: any, next: (error?: unknown) => void) => Promise<void>;
  createExpressHttpMiddleware: (options?: {
    attachAuthTo?: string;
    maxSkewMs?: number;
    onError?: (error: HmacAuthError, req: any, res: any, next: (error?: unknown) => void) => void;
    onBadSignature?: OnBadHttpSignature;
  }) => (req: any, res: any, next: (error?: unknown) => void) => Promise<void>;
  createHttpSignedFetchClient: (
    options: CreateHttpSignedFetchClientOptions
  ) => (url: string, options?: SignedHttpFetchClientCallOptions) => Promise<Response>;
  clients: {
    create: (options: CreateHmacClientOptions) => Promise<HmacClientCredentialWithSecret>;
    listClientIds: () => Promise<string[]>;
    get: (clientId: string) => Promise<HmacClientCredential | null>;
    delete: (clientId: string) => Promise<void>;
    regenerateSecret: (clientId: string, options?: RegenerateHmacSecretOptions) => Promise<HmacClientCredentialWithSecret>;
    setSecret: (clientId: string, secret: string, expiresAt?: number | Date | null, allowedIps?: string[]) => Promise<void>;
    setSecretHash: (
      clientId: string,
      secretHash: string,
      expiresAt?: number | Date | null,
      allowedIps?: string[]
    ) => Promise<void>;
    setAllowedIps: (clientId: string, allowedIps: string[]) => Promise<void>;
    getSecretHash: (clientId: string) => Promise<string | null>;
    revert: (clientId: string) => Promise<HmacCredentialRevertResult>;
  };
}

export function initializeHmacHttpAuth(options: InitializeHmacHttpAuthOptions): InitializedHmacHttpAuth {
  if (!options?.redis) {
    throw new Error("Redis connection is mandatory");
  }

  assertRedisClient(options.redis);

  const namespace = resolveNamespace(options.namespace);
  const maxSkewMs = options.maxSkewMs ?? DEFAULT_MAX_SKEW_MS;
  const defaultSecretLengthBytes = options.defaultSecretLengthBytes ?? DEFAULT_SECRET_LENGTH_BYTES;
  const dbSeedBackupTtlSeconds = options.dbSeedBackupTtlSeconds ?? DEFAULT_DB_SEED_BACKUP_TTL_SECONDS;
  const secretToken = options.secretToken;
  assertSecretLength(defaultSecretLengthBytes);
  const credentialStore = new RedisCredentialStore(options.redis, namespace);

  const verifyHttpSignature = async (input: VerifyHttpWithRedisInput): Promise<VerifiedHttpRequest> =>
    verifyHttpSignatureCore({
      ...input,
      redis: options.redis,
      namespace,
      maxSkewMs: input.maxSkewMs ?? maxSkewMs,
      onBadSignature: input.onBadSignature ?? options.onBadSignature,
      metadata: input.metadata,
    });

  const clients = createCredentialsClientsFactory({
    credentialStore,
    secretToken,
    defaultSecretLengthBytes,
    dbSeedBackupTtlSeconds,
  });

  const httpMiddlewareFactory = createHttpMiddlewareFactory({
    redis: options.redis,
    namespace,
    maxSkewMs,
    defaultOnBadSignature: options.onBadSignature,
  });

  const verifyHttpRequest = httpMiddlewareFactory();

  return {
    redis: options.redis,
    namespace,
    maxSkewMs,
    secretToken,
    verifyHttpRequest,
    verifyHttpSignature,
    createHttpMiddleware: httpMiddlewareFactory,
    createExpressHttpMiddleware: httpMiddlewareFactory,
    createHttpSignedFetchClient: (clientOptions) =>
      createHttpSignedFetchClient({
        ...clientOptions,
        hashToken: clientOptions.hashToken ?? secretToken,
      }),
    clients,
  };
}
