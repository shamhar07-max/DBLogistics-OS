import { Module } from '@nestjs/common';
import { WarehouseService } from './application/warehouse.service';
import { WarehouseController } from './presentation/warehouse.controller';
import { TradeModule } from '../trade';
@Module({ imports: [TradeModule], providers: [WarehouseService], controllers: [WarehouseController], exports: [WarehouseService] })
export class WarehouseModule {}
