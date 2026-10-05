import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: (process.env.CORS_ORIGINS ?? 'http://localhost:3000,http://localhost:3002').split(','), credentials: true, exposedHeaders: ['X-Request-Id'] });
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3001));
  console.log(`DigitalBurj Logistics API on :${process.env.PORT ?? 3001}/api/v1`);
}
bootstrap();
