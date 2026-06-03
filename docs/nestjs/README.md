# NestJS integration

This guide shows the pattern to expose `@naskot/node-hmac-auth-core` as a NestJS
module. Nest is not a peer dep of the lib; the integration lives entirely in the
application code.

## Install

```sh
npm install @naskot/node-hmac-auth-core @nestjs/common @nestjs/core redis
```

## Module + dynamic factory

```ts
// src/hmac-auth/hmac-auth.module.ts
import { DynamicModule, Global, Module } from "@nestjs/common";
import { createClient, type RedisClientType } from "redis";
import {
  initializeHmacHttpAuth,
  initializeHmacMessageAuth,
  type InitializedHmacHttpAuth,
  type InitializedHmacMessageAuth,
} from "@naskot/node-hmac-auth-core";

export const HMAC_HTTP_AUTH = Symbol("HMAC_HTTP_AUTH");
export const HMAC_MESSAGE_AUTH = Symbol("HMAC_MESSAGE_AUTH");
export const HMAC_REDIS = Symbol("HMAC_REDIS");

@Global()
@Module({})
export class HmacAuthModule {
  static forRoot(): DynamicModule {
    const redisProvider = {
      provide: HMAC_REDIS,
      useFactory: async () => {
        const client: RedisClientType = createClient({ url: process.env.REDIS_URL });
        client.on("error", (e) => console.error("[hmac] redis", e));
        await client.connect();
        return client;
      },
    };

    const httpProvider = {
      provide: HMAC_HTTP_AUTH,
      inject: [HMAC_REDIS],
      useFactory: (redis: RedisClientType): InitializedHmacHttpAuth =>
        initializeHmacHttpAuth({
          redis: redis as unknown as Parameters<typeof initializeHmacHttpAuth>[0]["redis"],
          namespace: process.env.HMAC_NAMESPACE,
          secretToken: process.env.HMAC_SECRET_TOKEN,
        }),
    };

    const messageProvider = {
      provide: HMAC_MESSAGE_AUTH,
      inject: [HMAC_REDIS],
      useFactory: (redis: RedisClientType): InitializedHmacMessageAuth =>
        initializeHmacMessageAuth({
          redis: redis as unknown as Parameters<typeof initializeHmacMessageAuth>[0]["redis"],
          namespace: process.env.HMAC_NAMESPACE,
          secretToken: process.env.HMAC_SECRET_TOKEN,
        }),
    };

    return {
      module: HmacAuthModule,
      providers: [redisProvider, httpProvider, messageProvider],
      exports: [HMAC_HTTP_AUTH, HMAC_MESSAGE_AUTH, HMAC_REDIS],
    };
  }
}
```

```ts
// src/app.module.ts
import { Module, MiddlewareConsumer, NestModule, Inject } from "@nestjs/common";
import { HmacAuthModule, HMAC_HTTP_AUTH } from "./hmac-auth/hmac-auth.module";
import { EchoController } from "./echo.controller";
import type { InitializedHmacHttpAuth } from "@naskot/node-hmac-auth-core";

@Module({
  imports: [HmacAuthModule.forRoot()],
  controllers: [EchoController],
})
export class AppModule implements NestModule {
  constructor(@Inject(HMAC_HTTP_AUTH) private readonly auth: InitializedHmacHttpAuth) {}

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(this.auth.createHttpMiddleware()).forRoutes("*");
  }
}
```

```ts
// src/echo.controller.ts
import { Controller, Post, Req, Body } from "@nestjs/common";
import type { Request } from "express";

@Controller("api")
export class EchoController {
  @Post("echo")
  echo(@Req() req: Request, @Body() body: unknown) {
    return { ok: true, clientId: (req as any).hmacAuth?.clientId, received: body };
  }
}
```

## Raw body capture

If your Express adapter does not preserve the raw body, plug `captureRawBody` at
bootstrap time:

```ts
import { captureRawBody } from "@naskot/node-hmac-auth-core";
import * as express from "express";

const app = await NestFactory.create(AppModule);
app.use(express.json({ verify: captureRawBody }));
```

## Outbound signed fetch from a service

```ts
import { Inject, Injectable } from "@nestjs/common";
import { HMAC_HTTP_AUTH } from "../hmac-auth/hmac-auth.module";
import type { InitializedHmacHttpAuth } from "@naskot/node-hmac-auth-core";

@Injectable()
export class TargetClient {
  constructor(@Inject(HMAC_HTTP_AUTH) private readonly auth: InitializedHmacHttpAuth) {}

  async ping(clientId: string) {
    const record = await this.auth.clients.get(clientId);
    if (!record) throw new Error(`${clientId} not in store`);
    const signedFetch = this.auth.createHttpSignedFetchClient({
      clientId,
      secret: record.secretHash,
      secretIsHashed: true,
    });
    return signedFetch("http://target.local/api/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ping: true }),
    });
  }
}
```

## What this guide does not cover

- Credential propagation between peers. Either expose your own admin route (signed
  with a dedicated provisioning credential) or use the companion package
  `@naskot/node-hmac-auth-core-propagation` which is the NestJS-friendly orchestrator
  for it over RabbitMQ.
