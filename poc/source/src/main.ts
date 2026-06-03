import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { HmacAuthService } from "./hmac-auth/hmac-auth.service";
import { ScenarioService } from "./scenario/scenario.service";

async function bootstrap() {
  // Standalone Nest context (no HTTP server). DI is wired, then we trigger
  // the lib boot explicitly so the scenario sees a fully ready HmacAuthService.
  const app = await NestFactory.createApplicationContext(AppModule);

  const hmac = app.get(HmacAuthService);
  await hmac.init();

  const scenario = app.get(ScenarioService);
  try {
    await scenario.run();
    console.info("[source] done. All POC scenarios passed.");
    await app.close();
    process.exit(0);
  } catch (err) {
    console.error("[source] FATAL", err);
    await app.close();
    process.exit(1);
  }
}

bootstrap().catch((err) => {
  console.error("[source] FATAL bootstrap", err);
  process.exit(1);
});
