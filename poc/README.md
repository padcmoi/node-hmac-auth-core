# POC

Minimal end-to-end demonstration that `@naskot/node-hmac-auth-core` works on its
own (no propagation orchestrator), wired as two NestJS apps that consume the
lib through a `HmacAuthModule` + `HmacAuthService` pair mirroring the pattern
documented in `docs/nestjs/README.md` and `.trash/service.md`.

## Stack

| Service        | Role                                                                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `redis-source` | Redis for the source's local credential store                                                                                                      |
| `redis-target` | Redis for the target's local credential store                                                                                                      |
| `target`       | NestJS app with three controllers (`AdminController`, `EchoController`, `RestrictedController`) and the HMAC middleware wired at the Express level |
| `source`       | NestJS standalone context running the `ScenarioService` which exercises the lib end-to-end then exits                                              |

Both ends share `HMAC_SECRET_TOKEN` so a `hashClientSecret(plain, token)` produces
identical hashes on both Redis instances.

## What the scenario asserts

The source's `ScenarioService.run()` proves:

### Part 1: rotation + revert lifecycle (`client_demo`)

1. Source creates `client_demo` locally.
2. Source pushes its `secretHash` to the target via the signed admin endpoint
   (authenticated as `admin_provisioner`, a shared credential both ends know).
3. Source signs three business calls to `/api/echo` and asserts the target
   identifies the caller as `client_demo`.
4. Source rotates `client_demo` via `auth.clients.regenerateSecret`, pushes the
   new hash, signs a call with the new secret (must pass), then signs a call
   with the **old** secret (must be rejected with 401).
5. Source calls `auth.clients.revert(client_demo)`, pushes the restored hash,
   signs a call with the original secret (must pass again).

### Part 2: multi-clientId scenarios

The source provisions **5 clientIds** (`admin_provisioner`, `toto`, `dudu`,
`titi`, `stranger`) and pushes **4 of them to the target**
(`admin_provisioner` + `toto` + `dudu` + `titi`); `stranger` stays source-only.

The target also exposes `/api/restricted`, locked by the runtime helper
`auth.runtime.hmacHttpMiddleware("toto", "dudu")` (allowlist).

| Test | Sign with                                  | Route             | Expectation                                                                                                                                    |
| ---- | ------------------------------------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 7A   | `stranger` (unknown on target)             | `/api/echo`       | `401 UNKNOWN_CLIENT`                                                                                                                           |
| 7B   | `toto` (same hash on both ends)            | `/api/echo`       | `201` with `clientId: "toto"`                                                                                                                  |
| 7C   | `titi` (known on target, not in allowlist) | `/api/restricted` | reject (`500 INTERNAL_ERROR` in vanilla Express because the runtime helper throws synchronously; the point is the controller is never reached) |
| 7D   | `toto` (in allowlist)                      | `/api/restricted` | `201`                                                                                                                                          |

## Run

```sh
docker compose up --build
```

Wait for the source to print `done. All POC scenarios passed.` and exit 0. The
target stays up.

Tear down:

```sh
docker compose down -v
```

## What this POC does NOT show

- Credential propagation across multiple targets, retries, rollback on partial
  failure. The companion package `@naskot/node-hmac-auth-core-propagation`
  handles that over RabbitMQ. Here, the application's own admin endpoint plays
  the role of the distribution channel.
- Message track (`signMessage` / `verifyMessage`). Covered by the unit tests
  (`test/message-auth.test.ts`).
