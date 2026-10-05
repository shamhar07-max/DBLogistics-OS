import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { CONFIG, loadConfig } from './config';
import { Db } from './db.service';
import { AuthService } from './auth.service';
import { OpGuard } from './op';
import { ApiExceptionFilter } from './errors';
import { S3Storage, STORAGE } from './storage';

@Global()
@Module({
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() }, Db, AuthService,
    { provide: APP_GUARD, useClass: OpGuard }, { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: STORAGE, useClass: S3Storage },
  ],
  exports: [CONFIG, Db, AuthService, STORAGE],
})
export class PlatformModule {}
