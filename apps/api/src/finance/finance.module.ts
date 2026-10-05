import { Module } from '@nestjs/common';
import { FinanceService } from './application/finance.service';
import { FinanceController } from './presentation/finance.controller';
@Module({ providers: [FinanceService], controllers: [FinanceController], exports: [FinanceService] })
export class FinanceModule {}
