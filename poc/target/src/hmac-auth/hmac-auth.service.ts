import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { createClient, type RedisClientType } from "redis";
import {
  createHmacRuntime,
  initializeHmacHttpAuth,
  initializeHmacMessageAuth,
  type HmacRuntime,
  type InitializedHmacHttpAuth,
  type InitializedHmacMessageAuth,
} from "@naskot/node-hmac-auth-core";

/**
 * Pattern mirrors the service.md spec from .trash/ and the docs/nestjs/README.md
 * guide: one boot function instantiates the lib once and exposes both tracks +
 * the aggregate runtime helper. The Nest provider lifecycle handles disconnect;
 * init is explicit so callers know exactly when the lib is ready.
 */
@Injectable()
export class HmacAuthService implements OnModuleDestroy {
  redis!: RedisClientType;
  http!: InitializedHmacHttpAuth;
  message!: InitializedHmacMessageAuth;
  runtime!: HmacRuntime;
  private ready = false;

  async init() {
    if (this.ready) return;

    const redis: RedisClientType = createClient({ url: process.env.REDIS_URL });
    redis.on("error", (e) => console.error("[hmac] redis error", e));
    await redis.connect();
    this.redis = redis;

    const redisLike = redis as unknown as Parameters<typeof initializeHmacHttpAuth>[0]["redis"];
    const namespace = process.env.HMAC_NAMESPACE!;
    const secretToken = process.env.HMAC_SECRET_TOKEN!;

    this.http = initializeHmacHttpAuth({
      redis: redisLike,
      namespace,
      secretToken,
      maxSkewMs: 5 * 60 * 1000,
      defaultSecretLengthBytes: 32,
      dbSeedBackupTtlSeconds: 600,
      onBadSignature: ({ clientId, method, path }) => console.warn(`[hmac] bad sig client=${clientId} ${method} ${path}`),
    });

    this.message = initializeHmacMessageAuth({
      redis: redisLike,
      namespace,
      secretToken,
    });

    this.runtime = createHmacRuntime(this.http);

    this.ready = true;
  }

  async onModuleDestroy() {
    await this.redis?.quit();
  }
}
