import { Module } from '@nestjs/common';
import {PeriodService} from './application/period.service';
import {PeriodController} from './presentation/period.controller';
import { FinanceService } from './application/finance.service';
import { FinanceController } from './presentation/finance.controller';
@Module({ providers: [FinanceService,PeriodService], controllers: [FinanceController,PeriodController], exports: [FinanceService] })
export class FinanceModule {}
