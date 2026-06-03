# Architecture

Contributor reference. The lib lives under `src/` and is organized in 6 domains. Every change goes through the single public entrypoint `src/index.ts`.

## Domains

```
src/
  core/         Pure crypto + canonical signing payloads, error class, IP / utils helpers.
  http/         HTTP track: client (signed fetch), server (verify + Express adapter),
                middleware factory, shared private helpers.
  message/      Message track: signMessage / verifyMessage on top of the same store.
  runtime/      Aggregate helper that wires HTTP + message track in one call.
  stores/       Redis credential store, nonce store, namespace helpers, record schema.
  index.ts      Single public entrypoint. Anything reachable from a consumer lives here.
```

### `src/core/`

Stateless. No Redis, no HTTP, no framework. Holds the canonical signing primitives
(`hashClientSecret`, `hashBody`, `safeEqualHex`, `buildSigningPayload`, `signRequest`),
the `HmacAuthError` class, the IP / CIDR allowlist matcher, and small `utils` (path
normalization, header lookup, canonical body / message stringification).

Cross-language ports MUST reproduce the byte output of these primitives exactly. See
[`docs/wire-contract.md`](./wire-contract.md) for the normative spec.

### `src/http/`

- `client/signed-fetch.ts` exposes `buildHttpSignedHeaders`, `createHttpSignedFetchClient`,
  `signedHttpFetch`. The fetch client signs the outbound request with the configured
  credential and forwards to the global `fetch`.
- `server/verify.ts` exposes the low-level `verifyHttpSignature(input)` which is the
  reference inbound checker (timestamp skew, nonce consume, expiresAt, allowedIps,
  constant-time signature comparison).
- `server/express.ts` wraps `verifyHttpSignature` in an Express-compatible middleware
  (`createExpressHttpHmacMiddleware`, alias `createHttpHmacMiddleware` for Nest /
  Connect-compatible adapters). Also exports `captureRawBody`.
- `middlewares.ts` exposes `createHttpMiddlewareFactory`, the small factory consumed
  by `initializeHmacHttpAuth` so the instance can hand out `createHttpMiddleware` /
  `createExpressHttpMiddleware` closures with the instance defaults pre-applied.
- `init.ts` composes everything into the `InitializedHmacHttpAuth` surface (the
  `clients` CRUD + `verifyHttpRequest` + `verifyHttpSignature` + signed fetch + middleware factory).
- `internal-helpers.ts` and `constants.ts` are private to `src/http/*`. Consumers
  never import from them.

### `src/message/`

- `signature.ts` exposes `buildMessageSigningPayload`, `signMessage`, `verifyMessage`
  (pure, no Redis).
- `init.ts` composes a Redis-backed surface (`InitializedHmacMessageAuth`) that
  resolves the signing secret from the credential store, exposes the same `clients`
  CRUD as the HTTP track (on a disjoint Redis namespace), and offers `signMessage` /
  `verifyMessage` Redis-aware variants.

### `src/runtime/`

`createHmacRuntime(hmacAuth)` is sugar over `InitializedHmacHttpAuth` that exposes
`createSignedFetchFromClientId`, `signedFetchWithClientId`, and a clientId-restricted
middleware factory `hmacHttpMiddleware(...clientIds)`. Strictly additive; nothing here
is wire-relevant.

### `src/stores/`

- `redis.ts` re-exports the public stores surface (`RedisCredentialStore`, `RedisNonceStore`,
  `buildRedisNamespaceKeys`, `resolveNamespace`, `RedisLikeClient`) plus the
  internal `parseStoredClientRecord` / `StoredClientCredentialRecord` re-export.
- `credential-store.ts` implements the per-namespace credential store on a
  `RedisLikeClient` (HSET / HGET / HDEL plus a `credentials-backup:<clientId>` key
  used by `clients.revert(...)`).
- `nonce-store.ts` implements the nonce consumer (`SET key 1 NX EX ttl`).
- `credential-record.ts` is the record schema + JSON parser, with backward-compatible
  fallback for legacy hash-only records.
- `namespace.ts` resolves the namespace string and builds the prefix keys.
- `redis-client.ts` exposes `RedisLikeClient` and `assertRedisClient`.
- `credentials-clients-factory.ts` is the shared `clients` lifecycle (create /
  regenerate / setSecret / setSecretHash / setAllowedIps / get / list / delete /
  revert) consumed by both `http/init.ts` and `message/init.ts`. Every rotation that
  changes the stored hash writes a TTL backup so `revert(clientId)` can roll back.

## Public-API rule

`src/index.ts` is the only file consumers may import from. Every other export under
`src/**/*.ts` is treated as private. PRs that broaden the public surface must update:

- `src/index.ts`
- `docs/wire-contract.md` (if cryptographic / on-wire)
- `docs/release-notes/<next-version>.md`
- `test/` (golden / suite coverage)

## Change workflow

1. Pick the smallest domain that owns the change. Avoid cross-domain edits.
2. Add or update the test that codifies the change (`test/`).
3. Run `npm run check && npm test && npm run build` locally.
4. Update `docs/release-notes/<next-version>.md`.
5. If the change touches the wire (headers, signing payload, Redis record JSON,
   error codes), update `docs/wire-contract.md` AND regenerate the test vectors.

## What is NOT in this lib

- Credential propagation between peers. That lives in the companion package
  `@naskot/node-hmac-auth-core-propagation`, which consumes this lib as a peer dep
  and adds the RabbitMQ-backed sync.
- HTTP routes for internal management of credentials. Applications expose their own
  admin endpoints if they need to remote-update a hash.
- Bootstrap-lock / federation autoboot semantics. The auth verifier is straight HMAC,
  no startup gating.
- SQL schema. Redis is the only store.
- Scheduler / cron. The lib is request-driven only.
