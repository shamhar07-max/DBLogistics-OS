import { Controller, Inject, Injectable, Module } from '@nestjs/common';
import { Ctx, Db, Op, type RequestContext } from '../platform';
@Injectable() export class OrganizationsService { constructor(@Inject(Db) private db: Db) {} legalEntities(ctx: RequestContext) { return this.db.run(ctx, (tx) => tx.q(`SELECT id, name, base_currency, jurisdiction, tax_registration_number FROM org.legal_entities ORDER BY name`)); } }
@Controller() export class OrganizationsController { constructor(@Inject(OrganizationsService) private s: OrganizationsService) {} @Op('listLegalEntities') l(@Ctx() c: RequestContext) { return this.s.legalEntities(c); } }
@Module({ providers: [OrganizationsService], controllers: [OrganizationsController] }) export class OrganizationsModule {}
