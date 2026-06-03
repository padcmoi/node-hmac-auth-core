# Wire Contract

This document is the canonical specification of the HMAC wire used by `@naskot/node-hmac-auth-core`. It is the single source of truth for cross-language ports (Python, Go, Rust, Java, ...) targeting interoperability with Node consumers. Every cryptographic primitive, header name, payload shape, and error code listed below is normative.

The contract level is `v1`. This wire is byte-identical to the auth surface of `@naskot/node-hmac-auth` v1.0.0 through v1.4.0: the same `hashClientSecret`, `buildSigningPayload`, `signRequest`, request headers, timestamp / nonce semantics, Redis credential record shape, and error codes. Cross-language ports built against the upstream lib remain interoperable.

> Companion artifacts (also normative):
>
> - Test vectors: [test/vectors/hash-client-secret.json](../test/vectors/hash-client-secret.json), [test/vectors/sign-request.json](../test/vectors/sign-request.json).
> - Sequence diagrams: [docs/diagrams/](./diagrams/).

## Cryptographic primitives

### `hashClientSecret(secret, secretToken?)`

```
hashClientSecret(secret, "")    = SHA-256(secret)                    hex lowercase
hashClientSecret(secret, token) = HMAC-SHA256(token, secret)         hex lowercase
```

- `secret` and `token` are UTF-8 strings. Empty `token` (or null/undefined) selects the fallback `SHA-256(secret)`.
- The output is always a 64-character lowercase hex string.
- Targets MUST produce byte-identical output for every case listed in [test/vectors/hash-client-secret.json](../test/vectors/hash-client-secret.json).

### `buildSigningPayload({method, path, timestamp, nonce, body})`

```
METHOD\n
PATH_WITH_QUERY\n
TIMESTAMP_MS\n
NONCE\n
SHA-256(BODY)
```

- `METHOD` is uppercased (`get` -> `GET`).
- `PATH_WITH_QUERY` is the request path including any `?query=...` part, normalized so an empty path becomes `/`. The lib's helper `normalizePath` parses `path` against `http://localhost` and emits `pathname + search`.
- `TIMESTAMP_MS` is the integer epoch in milliseconds (matches `Date.now()`).
- `NONCE` is a per-request unique value. UUID, ULID, or 16+ bytes of hex random are all valid.
- `SHA-256(BODY)` is the hex lowercase digest of the raw request body (empty body -> digest of the empty string).
- Lines are joined with the literal character `\n` (0x0A). There is no trailing newline.

### `signRequest(input)`

```
signRequest({method, path, timestamp, nonce, body, secret}) =
    HMAC-SHA256(secret, buildSigningPayload(input))   hex lowercase
```

- `secret` is the value the verifier holds locally. The canonical setup stores the `secretHash` on both ends so `secret = secretHash` on both sides; the application is responsible for getting the hash to the verifier through its own channel (an admin endpoint, a config push, the companion lib `@naskot/node-hmac-auth-core-propagation`, etc.).
- Comparison between the received signature and the locally computed one MUST be constant-time. The lib uses `timingSafeEqual` on the hex-decoded bytes; equivalent primitives in other languages (`hmac.compare_digest` in Python, `subtle.ConstantTimeCompare` in Go, ...) are acceptable.

### `buildMessageSigningPayload({clientId, messageHash})`

```
clientId|messageHash
```

- Used by the message track (`signMessage` / `verifyMessage`) for HMAC-protecting an arbitrary payload outside HTTP. The `messageHash` is the SHA-256 of the canonical JSON form of the payload (keys sorted recursively).

## HTTP transport

### Required headers (request)

| Header        | Value                                            |
| ------------- | ------------------------------------------------ |
| `x-client-id` | clientId of the calling credential               |
| `x-timestamp` | epoch milliseconds at signing time               |
| `x-nonce`     | per-request unique value (16+ bytes recommended) |
| `x-signature` | `signRequest(...)` hex output                    |

All four are mandatory. Missing any header rejects the request with the matching error code (see below).

### Timestamp skew & nonce replay

- Default `maxSkewMs` is 5 minutes. Requests whose `|now - timestamp| > maxSkewMs` are rejected (`TIMESTAMP_SKEW`).
- The nonce is consumed in Redis under `<namespace>:nonces` with TTL = `ceil(maxSkewMs / 1000)` seconds. A nonce reused inside that window is rejected (`REPLAYED_NONCE`).

### Allowed IPs

- A credential may carry an `allowedIps: string[]` of IP / CIDR rules. When non-empty, the verifier extracts the client IP from `metadata.ip / ips / forwardedFor / remoteAddress` plus the `x-forwarded-for` header and rejects requests outside the allowlist (`CLIENT_IP_NOT_ALLOWED`) or with no detectable client IP (`MISSING_CLIENT_IP`).

## Redis layout

The lib stores everything under a configurable namespace (default `"hmac"`).

| Key                                         | Type    | Content                                                                                                                                               |
| ------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<namespace>:clients`                       | hash    | credential record per clientId (JSON)                                                                                                                 |
| `<namespace>:nonces`                        | strings | one key per consumed nonce, TTL = ceil(maxSkewMs / 1000) seconds                                                                                      |
| `<namespace>:credentials-backup:<clientId>` | string  | previous `secretHash` written before every successful rotation, TTL = `dbSeedBackupTtlSeconds` (default 600s). Consumed by `clients.revert(clientId)` |

### Credential record JSON

```jsonc
{
  "secretHash": "hex lowercase, output of hashClientSecret",
  "createdAt": 1717000000000, // epoch ms
  "updatedAt": 1717000000000, // epoch ms
  "expiresAt": null, // epoch ms or null
  "allowedIps": ["10.0.0.0/8"], // string[]
}
```

The record is JSON-encoded with these exact keys. A legacy fallback in `parseStoredClientRecord` accepts records that contain only the `secretHash` string (pre-record format), so upgrades from very old data stay transparent.

## Error codes

`HmacAuthError.code` enumerates exactly these values. Each maps to a default HTTP status:

| Code                    | Default status |
| ----------------------- | -------------- |
| `MISSING_CLIENT_ID`     | 400 / 401      |
| `MISSING_SIGNATURE`     | 401            |
| `MISSING_TIMESTAMP`     | 401            |
| `MISSING_NONCE`         | 401            |
| `INVALID_TIMESTAMP`     | 401            |
| `TIMESTAMP_SKEW`        | 401            |
| `UNKNOWN_CLIENT`        | 401            |
| `CLIENT_EXPIRED`        | 401            |
| `MISSING_CLIENT_IP`     | 403            |
| `CLIENT_IP_NOT_ALLOWED` | 403            |
| `CLIENT_NOT_FOUND`      | 404            |
| `BAD_SIGNATURE`         | 401            |
| `REPLAYED_NONCE`        | 401            |
| `INTERNAL_ERROR`        | 500            |

## Certification procedure

A cross-language port is compliant when:

1. It reproduces every byte of `test/vectors/hash-client-secret.json` for `hashClientSecret`.
2. It reproduces every byte of `test/vectors/sign-request.json` for `signRequest`.
3. It implements the same four header names with the same semantics on the verifier side.
4. It uses constant-time comparison for the received vs computed signature.
5. It enforces the timestamp skew with the same window semantics (lib default 5 min).
6. It consumes nonces with the same TTL = ceil(maxSkewMs / 1000) seconds.

Sections of the contract not explicitly listed here (transport choice, framework integration, credential distribution) are application concerns; they do not affect interop with Node consumers.
