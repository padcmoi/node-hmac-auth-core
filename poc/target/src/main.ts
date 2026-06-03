import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import express from "express";
import { captureRawBody, hashClientSecret } from "@naskot/node-hmac-auth-core";
import { AppModule } from "./app.module";
import { HmacAuthService } from "./hmac-auth/hmac-auth.service";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  // Replace Nest's default JSON parser with one that captures the raw body for HMAC.
  app.use(express.json({ verify: captureRawBody }));

  // Light health route so docker compose can wait on us.
  app.use("/health", (_req: express.Request, res: express.Response) => res.json({ ok: true }));

  // Boot the lib explicitly so the middlewares see a ready instance.
  const hmac = app.get(HmacAuthService);
  await hmac.init();

  // The /api/restricted route is locked to the allowlist via the runtime helper.
  // Other registered clientIds reach the verify step OK but are rejected here.
  const allowlistMiddleware = hmac.runtime.hmacHttpMiddleware("toto", "dudu");

  // Wrap the runtime helper: it throws a plain Error synchronously when the
  // clientId is outside its allowlist. Express does not auto-forward thrown
  // errors from async middleware, so we catch and forward to the error handler.
  const wrappedAllowlist = async (req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> => {
    try {
      await allowlistMiddleware(req, res, next);
    } catch (err) {
      next(err);
    }
  };

  // Register HMAC middlewares BEFORE app.init() so they run before Nest's router.
  app.use("/api/admin", hmac.http.verifyHttpRequest);
  app.use("/api/echo", hmac.http.verifyHttpRequest);
  app.use("/api/restricted", wrappedAllowlist);

  // Translate any Error thrown inside allowlistMiddleware into a 403 response.
  app.use("/api/restricted", (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : "Forbidden";
    res.status(403).json({ error: "FORBIDDEN", message });
  });

  // Init Nest (registers controllers and the rest of the routing).
  await app.init();

  // Provision the shared admin credential so the source can call /api/admin/*.
  const provisionerClientId = process.env.PROVISIONER_CLIENT_ID!;
  const provisionerSecret = process.env.PROVISIONER_SECRET!;
  const provisionerHash = hashClientSecret(provisionerSecret, process.env.HMAC_SECRET_TOKEN);
  const existing = await hmac.http.clients.get(provisionerClientId);
  if (!existing || existing.secretHash !== provisionerHash) {
    await hmac.http.clients.setSecretHash(provisionerClientId, provisionerHash);
    console.info(`[target] provisioned admin credential ${provisionerClientId}`);
  } else {
    console.info(`[target] admin credential ${provisionerClientId} already in store`);
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.info(`[target] listening on :${port}`);
}

bootstrap().catch((err) => {
  console.error("[target] FATAL", err);
  process.exit(1);
});
