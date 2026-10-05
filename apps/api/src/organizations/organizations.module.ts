import { Body, Controller, Inject, Injectable, Module, Param } from '@nestjs/common';
import { audit, Ctx, Db, DomainError, Op, type RequestContext } from '../platform';

@Injectable()
export class OrganizationsService {
  constructor(@Inject(Db) private db: Db) {}
  legalEntities(ctx: RequestContext) { return this.db.run(ctx, (tx) => tx.q(`SELECT id, name, base_currency, jurisdiction, tax_registration_number FROM org.legal_entities ORDER BY name`)); }
  facilities(ctx: RequestContext) {
    return this.db.run(ctx, (tx) => tx.q(`SELECT f.id, f.name, f.kind, f.legal_entity_id, le.name AS legal_entity,
      COALESCE((SELECT json_agg(json_build_object('id', l.id, 'code', l.code, 'zone', l.zone) ORDER BY l.code) FROM org.locations l WHERE l.facility_id = f.id), '[]') AS locations
      FROM org.facilities f JOIN org.legal_entities le ON le.id = f.legal_entity_id ORDER BY f.name`));
  }
  createFacility(ctx: RequestContext, b: { legalEntityId: string; name: string; kind: string }) {
    return this.db.run(ctx, async (tx) => {
      if (!(await tx.maybe(`SELECT 1 FROM org.legal_entities WHERE id=$1`, [b.legalEntityId]))) throw new DomainError('NOT_FOUND', 'Legal entity not found.');
      if (await tx.maybe(`SELECT 1 FROM org.facilities WHERE legal_entity_id=$1 AND lower(name)=lower($2)`, [b.legalEntityId, b.name])) throw new DomainError('DUPLICATE', 'This entity already has a facility with that name.');
      const f = await tx.one(`INSERT INTO org.facilities(tenant_id, legal_entity_id, name, kind) VALUES ($1,$2,$3,$4) RETURNING id, name, kind`, [ctx.tenantId, b.legalEntityId, b.name, b.kind]);
      await audit(tx, ctx, 'facility.created', 'facility', f.id, { name: b.name, kind: b.kind }); return f;
    });
  }
  createLocation(ctx: RequestContext, facilityId: string, b: { code: string; zone?: string }) {
    return this.db.run(ctx, async (tx) => {
      if (!(await tx.maybe(`SELECT 1 FROM org.facilities WHERE id=$1`, [facilityId]))) throw new DomainError('NOT_FOUND', 'Facility not found.');
      if (await tx.maybe(`SELECT 1 FROM org.locations WHERE facility_id=$1 AND code=$2`, [facilityId, b.code])) throw new DomainError('DUPLICATE', `Location ${b.code} already exists in this facility.`);
      const l = await tx.one(`INSERT INTO org.locations(tenant_id, facility_id, code, zone) VALUES ($1,$2,$3,$4) RETURNING id, code, zone`, [ctx.tenantId, facilityId, b.code, b.zone ?? null]);
      await audit(tx, ctx, 'location.created', 'facility', facilityId, { code: b.code }); return l;
    });
  }
}
@Controller()
export class OrganizationsController {
  constructor(@Inject(OrganizationsService) private s: OrganizationsService) {}
  @Op('listLegalEntities') l(@Ctx() c: RequestContext) { return this.s.legalEntities(c); }
  @Op('listFacilities') f(@Ctx() c: RequestContext) { return this.s.facilities(c); }
  @Op('createFacility') cf(@Ctx() c: RequestContext, @Body() b: any) { return this.s.createFacility(c, b); }
  @Op('createLocation') cl(@Ctx() c: RequestContext, @Param('id') id: string, @Body() b: any) { return this.s.createLocation(c, id, b); }
}
@Module({ providers: [OrganizationsService], controllers: [OrganizationsController] }) export class OrganizationsModule {}
