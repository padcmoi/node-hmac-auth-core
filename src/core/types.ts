import type { RedisLikeClient } from "../stores/redis.js";

export interface BadHttpSignatureEvent {
  clientId: string;
  method: string;
  path: string;
  timestamp: number;
  nonce: string;
  receivedSignature: string;
  expectedSignature: string;
  headers: Record<string, string | string[] | undefined>;
  rawBody?: unknown;
  metadata?: unknown;
}

export type OnBadHttpSignature = (event: BadHttpSignatureEvent) => void | Promise<void>;

export interface SignInput {
  method: string;
  path: string;
  timestamp: number;
  nonce: string;
  body: string;
  secret: string;
}

export interface VerifyHttpSignatureInput {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  rawBody?: unknown;
  redis: RedisLikeClient;
  namespace?: string;
  maxSkewMs?: number;
  now?: number;
  onBadSignature?: OnBadHttpSignature;
  metadata?: unknown;
}

export interface VerifiedRequest {
  clientId: string;
  timestamp: number;
  nonce: string;
  signature: string;
}

export type VerifiedHttpRequest = VerifiedRequest;

export interface InitializeHmacHttpAuthOptions {
  redis: RedisLikeClient;
  namespace?: string;
  maxSkewMs?: number;
  defaultSecretLengthBytes?: number;
  secretToken?: string;
  onBadSignature?: OnBadHttpSignature;
  /**
   * TTL (seconds) of the `credentials-backup:<clientId>` Redis key created
   * automatically when a credential is rotated (setSecret / setSecretHash that
   * actually changes the stored hash). The backup is used by
   * `clients.revert(clientId)` to restore the previous secretHash. Defaults
   * to 600s (10 min).
   */
  dbSeedBackupTtlSeconds?: number;
}

export interface HmacCredentialRevertResult {
  reverted: boolean;
  restoredSecretHash?: string;
}

export interface InitializeHmacMessageAuthOptions {
  redis: RedisLikeClient;
  namespace?: string;
  defaultSecretLengthBytes?: number;
  secretToken?: string;
  /**
   * TTL (seconds) of the `credentials-backup:<clientId>` Redis key for the
   * message credential store. Same semantics as the HTTP variant. Default 600s.
   */
  dbSeedBackupTtlSeconds?: number;
}

export interface VerifyHttpWithRedisInput {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  rawBody?: unknown;
  now?: number;
  maxSkewMs?: number;
  onBadSignature?: OnBadHttpSignature;
  metadata?: unknown;
}

export interface HmacClientCredential {
  clientId: string;
  secretHash: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
  allowedIps: string[];
}

export interface HmacClientCredentialWithSecret extends HmacClientCredential {
  secret: string;
}

export interface CreateHmacClientOptions {
  clientId: string;
  expiresAt?: number | Date | null;
  secretLengthBytes?: number;
  plainSecret?: string;
  allowedIps?: string[];
}

export interface RegenerateHmacSecretOptions {
  expiresAt?: number | Date | null;
  secretLengthBytes?: number;
  plainSecret?: string;
  preserveExpiresAt?: boolean;
  allowedIps?: string[];
}

export interface SignMessageInput {
  clientId: string;
  message: unknown;
  secret: string;
  secretIsHashed?: boolean;
  hashToken?: string;
}

export interface SignedMessage {
  clientId: string;
  messageHash: string;
  signature: string;
}

export interface VerifyMessageInput extends SignMessageInput {
  signature: string;
}

export interface SignMessageWithRedisInput {
  clientId: string;
  message: unknown;
}

export interface VerifyMessageWithRedisInput extends SignMessageWithRedisInput {
  signature: string;
}
