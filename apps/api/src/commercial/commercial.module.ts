import { Module, forwardRef } from '@nestjs/common';
import { CommercialService } from './application/commercial.service';
import { CommercialController } from './presentation/commercial.controller';
import { LogisticsModule } from '../logistics';
@Module({ imports: [forwardRef(() => LogisticsModule)], providers: [CommercialService], controllers: [CommercialController], exports: [CommercialService] })
export class CommercialModule {}
