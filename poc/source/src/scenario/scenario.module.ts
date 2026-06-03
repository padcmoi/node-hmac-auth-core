import { Module } from "@nestjs/common";
import { HmacAuthModule } from "../hmac-auth/hmac-auth.module";
import { ScenarioService } from "./scenario.service";

@Module({
  imports: [HmacAuthModule],
  providers: [ScenarioService],
})
export class ScenarioModule {}
