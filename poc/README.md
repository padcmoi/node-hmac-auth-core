# POC

Minimal end-to-end demonstration that `@naskot/node-hmac-auth-core` works on its
own (no propagation orchestrator), wired as two NestJS apps that consume the
lib through a `HmacAuthModule` + `HmacAuthService` pair mirroring the pattern
documented in `docs/nestjs/README.md`.

## Stack

| Service | Role |
|---|---|
| `redis-source` | Redis for the source's local credential store |
| `redis-target` | Redis for the target's local credential store |
| `target` | NestJS app with the HMAC middleware wired at the Express level |
| `source` | NestJS standalone context running the `ScenarioService` then exits |

Both ends share `HMAC_SECRET_TOKEN` so a `hashClientSecret(plain, token)` produces
identical hashes on both Redis instances.

## Run

```sh
docker compose up --build
```

Wait for the source to print `done. All POC scenarios passed.` and exit 0.

Tear down:

```sh
docker compose down -v
```
