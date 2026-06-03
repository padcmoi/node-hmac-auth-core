# @naskot/node-hmac-auth-core

Pure HMAC auth primitives for Node.js APIs and microservices: sign outbound
requests, verify inbound requests, manage credentials (HTTP + message tracks)
against a Redis store. Framework-agnostic. Zero runtime dependencies.

## Install

```sh
npm install @naskot/node-hmac-auth-core redis
```

`redis` is a peer dep at runtime. Any Redis client matching the small
`RedisLikeClient` interface works (node-redis, ioredis via shim, fakeredis, etc.).

## Usage in 30 seconds

```ts
import { createClient } from "redis";
import { initializeHmacHttpAuth } from "@naskot/node-hmac-auth-core";

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

const auth = initializeHmacHttpAuth({
  redis: redis as unknown as Parameters<typeof initializeHmacHttpAuth>[0]["redis"],
  namespace: "hmac", // optional
  secretToken: process.env.HMAC_SECRET_TOKEN,
});

// Provision a credential
const created = await auth.clients.create({ clientId: "client_demo" });
console.log("secret to share with the caller:", created.secret);

// Protect routes
app.use(auth.createExpressHttpMiddleware());
app.post("/api/echo", (req, res) => {
  res.json({ ok: true, clientId: (req as any).hmacAuth.clientId });
});

// Sign an outbound call
const fetchSigned = auth.createHttpSignedFetchClient({
  clientId: "client_demo",
  secret: created.secret,
});
await fetchSigned("http://peer.local/api/whoami", { method: "GET" });
```

Full per-framework guides:

- [`docs/express/README.md`](./docs/express/README.md)
- [`docs/nestjs/README.md`](./docs/nestjs/README.md)

## What this lib gives you

| Surface           | What                                                                                                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP track        | `initializeHmacHttpAuth(...)` instance with `clients` CRUD, `verifyHttpRequest`, `verifyHttpSignature`, `createHttpSignedFetchClient`, `createHttpMiddleware` / `createExpressHttpMiddleware`. |
| Message track     | `initializeHmacMessageAuth(...)` instance with `clients` CRUD on a disjoint Redis namespace, `signMessage`, `verifyMessage` for non-HTTP transports.                                           |
| Aggregate runtime | `createHmacRuntime(auth)` returns `createSignedFetchFromClientId`, `signedFetchWithClientId`, `hmacHttpMiddleware(...clientIds)`.                                                              |
| Express adapter   | `createExpressHttpHmacMiddleware(...)`, `createHttpHmacMiddleware(...)`, `captureRawBody`.                                                                                                     |
| Stores            | `RedisCredentialStore`, `RedisNonceStore`, `buildRedisNamespaceKeys`, `resolveNamespace`.                                                                                                      |
| Pure crypto       | `hashClientSecret`, `hashBody`, `safeEqualHex`, `signRequest`, `buildSigningPayload`, `buildHttpSignedHeaders`, `buildMessageSigningPayload`, `signedHttpFetch`.                               |
| Error class       | `HmacAuthError` with 14 typed codes (`MISSING_*`, `BAD_SIGNATURE`, `UNKNOWN_CLIENT`, `CLIENT_IP_NOT_ALLOWED`, `REPLAYED_NONCE`, ...).                                                          |

## Rotation + revert

Every `setSecret` / `setSecretHash` / `regenerateSecret` that actually changes the
stored hash writes a TTL backup of the previous hash. `clients.revert(clientId)`
restores it within `dbSeedBackupTtlSeconds` (default 10 min). Outside that
window, `revert` is a no-op.

## Wire specification

`docs/wire-contract.md` is the normative spec for cross-language ports (Python,
Go, Rust, ...). The HMAC wire is byte-identical to the auth surface of
`@naskot/node-hmac-auth` 1.0.x through 1.4.0: same signing payload, same headers,
same Redis record JSON, same constant-time comparison.

Test vectors live in `test/vectors/`.

## POC

End-to-end demonstration of the lib alone (no propagation) in `poc/`:

```sh
cd poc && docker compose up --build
```

Source creates `client_demo`, pushes its `secretHash` to the target via a signed
admin call, runs business calls, rotates, verifies rejection of the old secret,
reverts, verifies acceptance of the original secret again. Exit code 0 when the
five steps succeed.

## Compatibility

| `@naskot/node-hmac-auth-core` | `@naskot/node-hmac-auth-core-propagation` |
| ----------------------------- | ----------------------------------------- |
| `1.0.0`                       | `1.0.0`                                   |

## Background

This package is the epured fork of [`@naskot/node-hmac-auth`](https://github.com/padcmoi/node-hmac-auth) 1.4.0.

Upstream had grown a credential-propagation layer on top of the auth primitives
(internal management HTTP route, bootstrap-window lock, federation defaults,
`propagation-only` purpose cantonment, propagate-to-targets orchestration). That
layer was helpful in a homogeneous federation but it conflated two distinct
responsibilities and made the auth lib opinionated about how credentials flow
between peers.

This fork strips the lib back to the auth primitives. Same wire, same Redis
layout, same test vectors. The propagation layer is now an independent companion
package, `@naskot/node-hmac-auth-core-propagation`, that consumes this lib as a
peer dep and adds RabbitMQ-backed orchestration on top.

If you used `@naskot/node-hmac-auth` 1.x without the propagation features, the
migration is renaming the import. See [`docs/release-notes/1.0.0.md`](./docs/release-notes/1.0.0.md)
for the full mapping of removed options / methods / types.

Upstream `@naskot/node-hmac-auth` is now deprecated.

## License

MIT, see [LICENSE](./LICENSE).
