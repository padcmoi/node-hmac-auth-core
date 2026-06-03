import { BadRequestException, Body, Controller, ForbiddenException, Inject, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { HmacAuthService } from "../hmac-auth/hmac-auth.service";

interface PutSecretHashBody {
  clientId?: string;
  secretHash?: string;
  allowedIps?: string[];
  expiresAt?: number | null;
}

@Controller("api/admin")
export class AdminController {
  constructor(@Inject(HmacAuthService) private readonly hmac: HmacAuthService) {}

  @Post("clients")
  async setSecretHash(@Req() req: Request, @Body() body: PutSecretHashBody) {
    // The HMAC middleware already verified the signature for this x-client-id.
    const callerId = String(req.headers["x-client-id"] ?? "");
    if (callerId !== process.env.PROVISIONER_CLIENT_ID) {
      throw new ForbiddenException(`only the provisioner can write admin/clients (got '${callerId}')`);
    }
    if (!body?.clientId || !body?.secretHash) {
      throw new BadRequestException("clientId and secretHash are required");
    }
    await this.hmac.http.clients.setSecretHash(body.clientId, body.secretHash, body.expiresAt ?? undefined, body.allowedIps);
    console.info(`[target] set secretHash for ${body.clientId}`);
    return { ok: true };
  }
}
