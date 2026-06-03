import { Module } from "@nestjs/common";
import { HmacAuthModule } from "./hmac-auth/hmac-auth.module";
import { AdminController } from "./admin/admin.controller";
import { EchoController } from "./echo/echo.controller";

@Module({
  imports: [HmacAuthModule],
  controllers: [AdminController, EchoController],
})
export class AppModule {}
