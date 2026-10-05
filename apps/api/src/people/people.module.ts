import { Body, Controller, Inject, Injectable, Module, Param, Query } from '@nestjs/common';
import { audit, assertScope, Ctx, Db, DomainError, Op, Qry, type RequestContext, type Tx } from '../platform';

@Injectable()
export class PeopleService {
  constructor(@Inject(Db) private db: Db) {}
  listEmployees(ctx: RequestContext) {
    return this.db.run(ctx, (tx) => tx.q(`SELECT e.id, e.full_name, e.job_title, e.department, e.status, e.hired_on, e.legal_entity_id,
      COALESCE((SELECT json_agg(json_build_object('kind', q.kind, 'valid_to', q.valid_to, 'valid', q.valid_to >= current_date) ORDER BY q.kind) FROM people.qualifications q WHERE q.employee_id = e.id), '[]') AS qualifications
      FROM people.employees e ORDER BY e.full_name LIMIT 500`));
  }
  createEmployee(ctx: RequestContext, b: any) {
    return this.db.run(ctx, async (tx) => {
      assertScope(ctx, 'people.manage', b.legalEntityId);
      const e = await tx.one(`INSERT INTO people.employees(tenant_id, legal_entity_id, full_name, job_title, department, hired_on) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, full_name`, [ctx.tenantId, b.legalEntityId, b.fullName, b.jobTitle ?? null, b.department ?? null, b.hiredOn ?? null]);
      await audit(tx, ctx, 'employee.created', 'employee', e.id); return e;
    });
  }
  addQualification(ctx: RequestContext, employeeId: string, b: any) {
    return this.db.run(ctx, async (tx) => {
      if (!(await tx.maybe(`SELECT 1 FROM people.employees WHERE id=$1`, [employeeId]))) throw new DomainError('NOT_FOUND', 'Employee not found.');
      const q = await tx.one(`INSERT INTO people.qualifications(tenant_id, employee_id, kind, reference, issued_on, valid_to) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, kind, valid_to`, [ctx.tenantId, employeeId, b.kind, b.reference ?? null, b.issuedOn, b.validTo]);
      await audit(tx, ctx, 'qualification.recorded', 'employee', employeeId, { kind: b.kind, validTo: b.validTo }); return q;
    });
  }
  /** Lists qualifications; `withinDays` narrows to those expiring (or already expired) within N days. */
  listQualifications(ctx: RequestContext, withinDays?: number) {
    return this.db.run(ctx, (tx) => tx.q(`SELECT q.id, q.kind, q.reference, q.issued_on, q.valid_to, q.valid_to < current_date AS expired, (q.valid_to - current_date) AS days_left, e.id AS employee_id, e.full_name
      FROM people.qualifications q JOIN people.employees e ON e.id = q.employee_id ${withinDays === undefined ? '' : 'WHERE q.valid_to <= current_date + $1::int'} ORDER BY q.valid_to LIMIT 500`, withinDays === undefined ? [] : [withinDays]));
  }
  /** Eligibility rule: an expired / missing qualification blocks the assignment. Used by trip dispatch. */
  async assertQualified(tx: Tx, employeeId: string, kind: string, onDate: string) {
    const ok = await tx.maybe(`SELECT 1 FROM people.qualifications WHERE employee_id=$1 AND kind=$2 AND $3::date BETWEEN issued_on AND valid_to`, [employeeId, kind, onDate]);
    if (!ok) { const e = await tx.maybe(`SELECT full_name FROM people.employees WHERE id=$1`, [employeeId]); throw new DomainError('QUALIFICATION_REQUIRED', `${e?.full_name ?? 'Employee'} has no valid "${kind}" qualification on ${onDate}.`, { employeeId, kind }); }
  }
  listAssets(ctx: RequestContext) {
    return this.db.run(ctx, (tx) => tx.q(`SELECT a.id, a.kind, a.code, a.status, a.next_service_due, a.calibration_due, a.facility_id, f.name AS facility,
      (a.next_service_due IS NOT NULL AND a.next_service_due <= current_date + 14) AS service_due_soon, (a.calibration_due IS NOT NULL AND a.calibration_due <= current_date + 14) AS calibration_due_soon
      FROM people.assets a LEFT JOIN org.facilities f ON f.id = a.facility_id ORDER BY a.kind, a.code LIMIT 500`));
  }
  createAsset(ctx: RequestContext, b: any) {
    return this.db.run(ctx, async (tx) => {
      const a = await tx.one(`INSERT INTO people.assets(tenant_id, facility_id, kind, code, next_service_due, calibration_due) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, code`, [ctx.tenantId, b.facilityId ?? null, b.kind, b.code, b.nextServiceDue ?? null, b.calibrationDue ?? null]);
      await audit(tx, ctx, 'asset.registered', 'asset', a.id); return a;
    });
  }
}
@Controller()
export class PeopleController {
  constructor(@Inject(PeopleService) private s: PeopleService) {}
  @Op('listEmployees') le(@Ctx() c: RequestContext) { return this.s.listEmployees(c); }
  @Op('createEmployee') ce(@Ctx() c: RequestContext, @Body() b: any) { return this.s.createEmployee(c, b); }
  @Op('addQualification') aq(@Ctx() c: RequestContext, @Param('id') id: string, @Body() b: any) { return this.s.addQualification(c, id, b); }
  @Op('listQualifications') lq(@Ctx() c: RequestContext, @Qry() q: any) { return this.s.listQualifications(c, q.withinDays); }
  @Op('listAssets') la(@Ctx() c: RequestContext) { return this.s.listAssets(c); }
  @Op('createAsset') ca(@Ctx() c: RequestContext, @Body() b: any) { return this.s.createAsset(c, b); }
}
@Module({ providers: [PeopleService], controllers: [PeopleController], exports: [PeopleService] }) export class PeopleModule {}
void Query;
