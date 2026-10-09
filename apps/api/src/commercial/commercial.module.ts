import { Module, forwardRef } from '@nestjs/common';
import { CommercialService } from './application/commercial.service';
import { CommercialController } from './presentation/commercial.controller';
import { LogisticsModule } from '../logistics';
import { ProcurementService } from './application/procurement.service';
import { ProcurementController } from './presentation/procurement.controller';
@Module({ imports: [forwardRef(() => LogisticsModule)], providers: [CommercialService, ProcurementService], controllers: [CommercialController, ProcurementController], exports: [CommercialService] })
export class CommercialModule {}
