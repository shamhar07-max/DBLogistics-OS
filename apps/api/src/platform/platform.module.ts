import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { CONFIG, loadConfig, type Config } from './config';
import { Db } from './db.service';
import { AuthService } from './auth.service';
import { OpGuard } from './op';
import { ApiExceptionFilter } from './errors';
import { DiskStorage, S3Storage, STORAGE } from './storage';
import { HealthController } from './health.controller';

@Global()
@Module({
  controllers: [HealthController],
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() }, Db, AuthService,
    { provide: APP_GUARD, useClass: OpGuard }, { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: STORAGE, inject: [CONFIG], useFactory: (c: Config) => (c.DEV_AUTH_SECRET && !c.S3_ENDPOINT ? new DiskStorage(c) : new S3Storage(c)) },
  ],
  exports: [CONFIG, Db, AuthService, STORAGE],
})
export class PlatformModule {}
