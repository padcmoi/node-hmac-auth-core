import { Inject, Injectable } from "@nestjs/common";
import { createHttpSignedFetchClient, hashClientSecret } from "@naskot/node-hmac-auth-core";
import { HmacAuthService } from "../hmac-auth/hmac-auth.service";

const TARGET_BASE_URL = process.env.TARGET_BASE_URL!;
const PROVISIONER_CLIENT_ID = process.env.PROVISIONER_CLIENT_ID!;
const PROVISIONER_SECRET = process.env.PROVISIONER_SECRET!;
const SECRET_TOKEN = process.env.HMAC_SECRET_TOKEN!;
const DEMO_CLIENT_ID = "client_demo";

function log(label: string, payload?: unknown) {
  if (payload === undefined) {
    console.info(`[source] ${label}`);
  } else {
    console.info(`[source] ${label}`, payload);
  }
}

function fail(label: string, payload?: unknown): never {
  if (payload === undefined) {
    console.error(`[source][FAIL] ${label}`);
  } else {
    console.error(`[source][FAIL] ${label}`, payload);
  }
  process.exit(1);
}

@Injectable()
export class ScenarioService {
  constructor(@Inject(HmacAuthService) private readonly hmac: HmacAuthService) {}

  async run() {
    // Idempotent init: HmacAuthService.init() is a no-op after the first call.
    await this.hmac.init();

    // Both ends share HMAC_SECRET_TOKEN so a hashClientSecret(plain, token)
    // produces an identical hash on both sides.
    const provisionerFetch = createHttpSignedFetchClient({
      clientId: PROVISIONER_CLIENT_ID,
      secret: PROVISIONER_SECRET,
      hashToken: SECRET_TOKEN,
    });

    const pushSecretHash = async (label: string, clientId: string, secretHash: string) => {
      log(`${label}: pushing secretHash for ${clientId} to target`);
      const res = await provisionerFetch(`${TARGET_BASE_URL}/api/admin/clients`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId, secretHash }),
      });
      if (!res.ok) {
        fail(`${label}: target rejected provisioning (status=${res.status})`, await res.text());
      }
    };

    // ============================================================
    // Step 1-5: client_demo lifecycle (create / push / call / rotate / revert)
    // ============================================================
    log("step 1: creating local credential client_demo");
    const created = await this.hmac.http.clients.create({ clientId: DEMO_CLIENT_ID });
    log("step 1 done: secretHash =", created.secretHash);

    await pushSecretHash("step 2", DEMO_CLIENT_ID, created.secretHash);

    const demoFetch = createHttpSignedFetchClient({
      clientId: DEMO_CLIENT_ID,
      secret: created.secret,
      hashToken: SECRET_TOKEN,
    });

    log("step 3: 3 signed business calls with the initial secret");
    for (let i = 1; i <= 3; i += 1) {
      const res = await demoFetch(`${TARGET_BASE_URL}/api/echo`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ping: i }),
      });
      if (!res.ok) {
        fail(`step 3 call ${i}: status=${res.status}`, await res.text());
      }
      const payload = (await res.json()) as { ok: boolean; clientId: string; received: unknown };
      if (payload.clientId !== DEMO_CLIENT_ID) {
        fail(`step 3 call ${i}: target identified the wrong clientId`, payload);
      }
      log(`step 3 call ${i} OK:`, payload);
    }

    log("step 4: rotating client_demo");
    const rotated = await this.hmac.http.clients.regenerateSecret(DEMO_CLIENT_ID);
    log(`step 4: rotation done. New plain=${rotated.secret}`);
    if (rotated.secretHash === created.secretHash) {
      fail("step 4: rotation produced the same hash as before");
    }
    await pushSecretHash("step 4", DEMO_CLIENT_ID, rotated.secretHash);

    const rotatedFetch = createHttpSignedFetchClient({
      clientId: DEMO_CLIENT_ID,
      secret: rotated.secret,
      hashToken: SECRET_TOKEN,
    });

    const rotatedRes = await rotatedFetch(`${TARGET_BASE_URL}/api/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phase: "after-rotation" }),
    });
    if (!rotatedRes.ok) {
      fail("step 4: signed call with rotated secret rejected", await rotatedRes.text());
    }
    log("step 4 OK: signed call with rotated secret passed");

    const staleRes = await demoFetch(`${TARGET_BASE_URL}/api/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phase: "stale" }),
    });
    if (staleRes.ok) {
      fail("step 4: target accepted the OLD secret after rotation");
    }
    log(`step 4 OK: target rejected OLD secret with status=${staleRes.status}`);

    log("step 5: reverting client_demo to previous hash");
    const reverted = await this.hmac.http.clients.revert(DEMO_CLIENT_ID);
    if (!reverted.reverted || !reverted.restoredSecretHash) {
      fail("step 5: revert returned no-op", reverted);
    }
    const expectedRestoredHash = hashClientSecret(created.secret, SECRET_TOKEN);
    if (reverted.restoredSecretHash !== expectedRestoredHash) {
      fail("step 5: restoredSecretHash does not match original", {
        restored: reverted.restoredSecretHash,
        expected: expectedRestoredHash,
      });
    }
    await pushSecretHash("step 5", DEMO_CLIENT_ID, reverted.restoredSecretHash);

    const restoredRes = await demoFetch(`${TARGET_BASE_URL}/api/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phase: "after-revert" }),
    });
    if (!restoredRes.ok) {
      fail("step 5: signed call with original secret rejected after revert", await restoredRes.text());
    }
    log("step 5 OK: signed call with original secret passed after revert");
  }
}
