import { Body, Controller, Post, Req } from "@nestjs/common";
import type { Request } from "express";

@Controller("api")
export class RestrictedController {
  @Post("restricted")
  restricted(@Req() req: Request, @Body() body: unknown) {
    const callerId = String(req.headers["x-client-id"] ?? "");
    return { ok: true, route: "restricted", clientId: callerId, received: body };
  }
}
