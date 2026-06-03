import { Inject, Injectable } from "@nestjs/common";
import { HmacAuthService } from "../hmac-auth/hmac-auth.service";

@Injectable()
export class ScenarioService {
  constructor(@Inject(HmacAuthService) private readonly hmac: HmacAuthService) {}

  async run() {
    // Scaffold stub; the real scenarios are added in follow-up commits.
    await this.hmac.init();
  }
}
