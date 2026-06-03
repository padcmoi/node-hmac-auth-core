import { Module } from "@nestjs/common";
import { HmacAuthModule } from "./hmac-auth/hmac-auth.module";
import { ScenarioModule } from "./scenario/scenario.module";

@Module({
  imports: [HmacAuthModule, ScenarioModule],
})
export class AppModule {}
