import { Module, forwardRef } from '@nestjs/common';
import { LogisticsService } from './application/logistics.service';
import { LogisticsController } from './presentation/logistics.controller';
import { FinanceModule } from '../finance';
@Module({ imports: [FinanceModule], providers: [LogisticsService], controllers: [LogisticsController], exports: [LogisticsService] })
export class LogisticsModule {}
