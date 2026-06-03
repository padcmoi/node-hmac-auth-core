# Express integration

This guide shows the minimum wiring to protect an Express route with the HMAC
middleware exposed by `@naskot/node-hmac-auth-core`. Express is not a peer dep
of the lib; the middleware factory works through duck typing on `(req, res, next)`.

## Install

```sh
npm install @naskot/node-hmac-auth-core express redis
```

## Bootstrap

```ts
import express from "express";
import { createClient, type RedisClientType } from "redis";
import { captureRawBody, createExpressHttpHmacMiddleware, initializeHmacHttpAuth } from "@naskot/node-hmac-auth-core";

async function main() {
  const redis: RedisClientType = createClient({ url: process.env.REDIS_URL });
  redis.on("error", (e) => console.error("[hmac] redis", e));
  await redis.connect();

  const auth = initializeHmacHttpAuth({
    redis: redis as unknown as Parameters<typeof initializeHmacHttpAuth>[0]["redis"],
    namespace: process.env.HMAC_NAMESPACE, // optional, default "hmac"
    secretToken: process.env.HMAC_SECRET_TOKEN, // optional pepper
    maxSkewMs: 5 * 60 * 1000, // optional, default 5 min
  });

  // Provision a demo credential the first time the app boots.
  if (!(await auth.clients.get("client_demo"))) {
    const created = await auth.clients.create({ clientId: "client_demo" });
    console.info("Created client_demo, share its plain secret with the caller:", created.secret);
  }

  const app = express();
  app.use(express.json({ verify: captureRawBody }));

  // Two equivalent ways to attach the middleware:
  //   1. Directly:
  app.post("/api/echo", createExpressHttpHmacMiddleware({ redis: auth.redis, namespace: auth.namespace }), (req, res) => {
    res.json({ ok: true, clientId: (req as any).hmacAuth.clientId, received: req.body });
  });

  //   2. Via the factory exposed by the auth instance (pre-fills options):
  const protect = auth.createExpressHttpMiddleware();
  app.get("/api/whoami", protect, (req, res) => {
    res.json({ clientId: (req as any).hmacAuth.clientId });
  });

  app.listen(3000, () => console.info("listening on :3000"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

## Signing an outbound call

```ts
import { createHttpSignedFetchClient } from "@naskot/node-hmac-auth-core";

const signedFetch = createHttpSignedFetchClient({
  clientId: "client_demo",
  secret: "<plain secret you got at create time>",
  // Or: secretIsHashed: true, secret: "<secretHash from the target store>",
  // Or: derive from a running instance with auth.createHttpSignedFetchClient(...)
});

const res = await signedFetch("http://target.local/api/echo", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ hello: "world" }),
});
```

## Error mapping

When verification fails, the middleware writes `res.status(err.status).json({ error: err.code, message: err.message })`
by default. Override with `onError(error, req, res, next)` in the middleware options for a custom shape.

## Rotation + revert

`auth.clients.regenerateSecret(clientId)` issues a new secret and writes a TTL backup
of the previous hash. `auth.clients.revert(clientId)` restores that previous hash if
the backup is still alive (default 10 min). Outside that window, `revert` is a no-op.

## What this guide does not cover

- Distributing the new `secretHash` to peer services after a rotation. Either expose
  an admin endpoint of your own (signed with a dedicated admin credential and writing
  to the target's local store via `auth.clients.setSecretHash`), or use the companion
  package `@naskot/node-hmac-auth-core-propagation` which automates that over RabbitMQ.
