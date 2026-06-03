# Changelog

This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and Semantic Versioning.

## [1.0.0] - 2026-06-03

First release. Epured fork of `@naskot/node-hmac-auth` 1.4.0: same auth wire, propagation layer removed.

### Surface kept (byte-identical to upstream)

- `initializeHmacHttpAuth(...)` and `initializeHmacMessageAuth(...)`, with their full `clients` CRUD (`create`, `listClientIds`, `get`, `delete`, `regenerateSecret`, `setSecret`, `setSecretHash`, `setAllowedIps`, `getSecretHash`, `revert`).
- `verifyHttpRequest` and low-level `verifyHttpSignature`.
- `createExpressHttpMiddleware` / `createHttpMiddleware` factories on the instance, plus standalone `createExpressHttpHmacMiddleware` / `createHttpHmacMiddleware` and `captureRawBody`.
- `createHttpSignedFetchClient`, `buildHttpSignedHeaders`, `signedHttpFetch`.
- `signMessage`, `verifyMessage`, `buildMessageSigningPayload`.
- `createHmacRuntime(...)` aggregate helper and `HmacRuntime` type.
- Pure crypto: `hashClientSecret`, `hashBody`, `safeEqualHex`, `signRequest`, `buildSigningPayload`.
- Stores: `RedisCredentialStore`, `RedisNonceStore`, `buildRedisNamespaceKeys`, `resolveNamespace`, `RedisLikeClient`.
- TTL backup written on every rotation so `clients.revert(clientId)` can roll back within `dbSeedBackupTtlSeconds` (default 600s).
- `HmacAuthError` with the 14 auth-relevant codes.

### Surface removed (was the propagation layer of upstream)

- Methods on the HTTP instance: `propagateClientToApis`, `handleInternalManagementRequest`, `createInternalManagementMiddleware`, `createExpressInternalManagementMiddleware`.
- Readonly field on the HTTP instance: `internalManagementRoute`.
- Init options: `internalManagementRoute`, `requireBootstrapClientId`, `messageAuth`.
- Bootstrap-window lock on the message track (no more `BOOTSTRAP_LOCKED` throws).
- Purpose cantonment on credentials (no more `PROPAGATION_ONLY_FORBIDDEN`, no more `purpose: "propagation-only"`).
- Record fields `fromDbSeed?` and `purpose?` on `HmacClientCredential`.
- The `options?: HmacCredentialWriteOptions` last param on `clients.setSecret` / `clients.setSecretHash` (the type only carried `fromDbSeed` and `purpose`, both gone).
- Error codes `INTERNAL_ROUTE_DISABLED`, `PROPAGATION_ONLY_FORBIDDEN`, `BOOTSTRAP_LOCKED`.
- Types `HmacInternalManagementRequestInput`, `HmacInternalManagementRequestResult`, `HmacInternalPropagationOperation`, `HmacPropagateTargetStore`, `PropagateHmacClientOptions`, `PropagateHmacClientResult`, `PropagateServiceCreateOptions`, `PropagateServiceUpdateOptions`, `PropagateServiceDeleteOptions`, `PropagateServiceHealthOptions`, `HmacCredentialPurpose`, `HmacMessageAuthBridge`, `HmacCredentialWriteOptions`.

### Notes

- Wire-contract pinned at v1. The signing payload, header set, Redis record JSON, nonce TTL semantics and error codes used by the verifier are byte-identical to upstream. Cross-language ports interoperate unchanged.
- The rotation backup is now unconditional. Upstream wrote a backup only when `fromDbSeed: true` was passed; the fork writes a backup whenever the stored hash actually changes. `revert` keeps the same semantics.
- For credential propagation between peers, use the companion package `@naskot/node-hmac-auth-core-propagation` (RabbitMQ-backed orchestrator that consumes this lib as a peer dep).

### Compatibility

| `@naskot/node-hmac-auth-core` | `@naskot/node-hmac-auth-core-propagation` |
| ----------------------------- | ----------------------------------------- |
| `1.0.0`                       | `1.0.0`                                   |

### POC

`poc/docker-compose.yml` runs one source + one target + one Redis each. Source provisions `client_demo`, pushes its `secretHash` via a signed admin endpoint, exercises business calls, rotation with rejection of the stale secret, and revert with re-acceptance of the original secret. Then a second scenario covers a 4-clientId / 5-clientId asymmetric setup with an allowlist-restricted route. Exit 0 on success.
