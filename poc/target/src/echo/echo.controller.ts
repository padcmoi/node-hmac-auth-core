import { Body, Controller, Post, Req } from "@nestjs/common";
import type { Request } from "express";

@Controller("api")
export class EchoController {
  @Post("echo")
  echo(@Req() req: Request, @Body() body: unknown) {
    // The HMAC middleware already verified the signature for this x-client-id.
    const callerId = String(req.headers["x-client-id"] ?? "");
    return { ok: true, clientId: callerId, received: body };
  }
}
