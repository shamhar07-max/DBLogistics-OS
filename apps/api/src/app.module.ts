import { Module } from '@nestjs/common';
import { PlatformModule } from './platform';
import { IdentityModule } from './identity';
import { OrganizationsModule } from './organizations';
import { PartiesModule } from './parties';
import { DocumentsModule } from './documents';
import { CollaborationModule } from './collaboration';
import { CommercialModule } from './commercial';
import { LogisticsModule } from './logistics';
import { TransportModule } from './transport';
import { WarehouseModule } from './warehouse';
import { TradeModule } from './trade';
import { FinanceModule } from './finance';
import { AutomationModule } from './automation';
import { IntelligenceModule } from './intelligence';
import { IntegrationsModule } from './integrations';
import { PeopleModule } from './people';
import { QualityModule } from './quality';
import { AdministrationModule } from './administration';
import { PrintingModule } from './printing';

@Module({ imports: [PlatformModule, IdentityModule, OrganizationsModule, PartiesModule, DocumentsModule, CollaborationModule, CommercialModule, LogisticsModule, TransportModule, WarehouseModule, TradeModule, FinanceModule, AutomationModule, IntelligenceModule, IntegrationsModule, PeopleModule, QualityModule, AdministrationModule, PrintingModule] })
export class AppModule {}
