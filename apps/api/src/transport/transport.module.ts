import { Body, Controller, Inject, Injectable, Module, Param } from '@nestjs/common';
import { audit, assertScope, Ctx, Db, DomainError, emit, Op, type RequestContext, type Tx } from '../platform';
import { PeopleModule, PeopleService } from '../people';

/** Offline-first device sync: each command carries commandId/device/actor/observed version/device time; server receipt time is stored separately. */
@Injectable()
export class TransportService {
  constructor(@Inject(Db) private db: Db, @Inject(PeopleService) private people: PeopleService) {}
  listTrips(ctx: RequestContext) {
    return this.db.run(ctx, (tx) => tx.q(`SELECT t.id, t.ref, t.status, t.vehicle_ref, t.version, p.legal_name AS transporter, e.full_name AS driver, t.driver_employee_id,
      COALESCE((SELECT json_agg(json_build_object('id', s.id, 'seq', s.seq, 'kind', s.kind, 'address', s.address, 'status', s.status, 'shipmentId', s.shipment_id, 'shipmentRef', sh.ref, 'pod', pod.signed_by IS NOT NULL, 'signedBy', pod.signed_by) ORDER BY s.seq)
        FROM transport.trip_stops s LEFT JOIN logistics.shipments sh ON sh.id = s.shipment_id LEFT JOIN transport.proofs_of_delivery pod ON pod.trip_stop_id = s.id WHERE s.trip_id = t.id), '[]') AS stops
      FROM transport.trips t JOIN parties.parties p ON p.id = t.transporter_party_id LEFT JOIN people.employees e ON e.id = t.driver_employee_id ORDER BY t.created_at DESC LIMIT 200`));
  }
  createTrip(ctx: RequestContext, b: any) {
    return this.db.run(ctx, async (tx) => {
      const tp = await tx.maybe(`SELECT 1 FROM parties.party_roles WHERE party_id=$1 AND role='transporter'`, [b.transporterPartyId]); if (!tp) throw new DomainError('VALIDATION_FAILED', 'Party is not a transporter.');
      const ref = (await tx.one<{ r: string }>(`SELECT platform.next_ref('trip','TRP') r`)).r;
      const t = await tx.one(`INSERT INTO transport.trips(tenant_id, ref, transporter_party_id, driver_employee_id, vehicle_ref) VALUES ($1,$2,$3,$4,$5) RETURNING id, ref, status, version`, [ctx.tenantId, ref, b.transporterPartyId, b.driverEmployeeId ?? null, b.vehicleRef ?? null]);
      let seq = 1; for (const s of b.stops) await tx.q(`INSERT INTO transport.trip_stops(tenant_id, trip_id, seq, kind, shipment_id, address) VALUES ($1,$2,$3,$4,$5,$6)`, [ctx.tenantId, t.id, seq++, s.kind, s.shipmentId ?? null, s.address]);
      await audit(tx, ctx, 'trip.planned', 'trip', t.id); return t;
    });
  }
  /** Dispatch is blocked when the assigned driver has no valid driving qualification on the dispatch date. */
  dispatchTrip(ctx: RequestContext, id: string) {
    return this.db.run(ctx, async (tx) => {
      const t = await tx.maybe(`SELECT * FROM transport.trips WHERE id=$1 FOR UPDATE`, [id]); if (!t) throw new DomainError('NOT_FOUND', 'Trip not found.');
      if (t.status !== 'planned') throw new DomainError('INVALID_STATE_TRANSITION', `Trip is ${t.status}.`);
      if (t.driver_employee_id) await this.people.assertQualified(tx, t.driver_employee_id, 'driving', new Date().toISOString().slice(0, 10));
      await tx.q(`UPDATE transport.trips SET status='dispatched' WHERE id=$1`, [id]);
      await audit(tx, ctx, 'trip.dispatched', 'trip', id); await emit(tx, ctx, 'TripDispatched', 'trip', id, {});
      return { id, status: 'dispatched' };
    });
  }

  async sync(ctx: RequestContext, b: any) {
    const results: any[] = [];
    for (const cmd of b.commands) {
      // One transaction per command: a rejected command must not roll back accepted ones.
      results.push(await this.db.run({ ...ctx, actorKind: 'device' }, async (tx) => {
        const prior = await tx.maybe(`SELECT status, result FROM transport.device_commands WHERE command_id=$1`, [cmd.commandId]);
        if (prior) return { commandId: cmd.commandId, status: prior.status, replay: true, ...prior.result };
        let status: 'accepted' | 'rejected' | 'conflict' = 'accepted'; let result: Record<string, unknown> = {};
        await tx.q('SAVEPOINT cmd');
        try { result = await this.apply(tx, ctx, b.deviceId, cmd); }
        catch (e: any) { await tx.q('ROLLBACK TO SAVEPOINT cmd'); status = e?.code === 'INVALID_STATE_TRANSITION' ? 'conflict' : 'rejected'; result = { error: e?.code ?? 'ERROR', message: e?.message }; }
        await tx.q(`INSERT INTO transport.device_commands(tenant_id, command_id, device_id, actor_user_id, type, observed_version, device_time, status, result) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
          [ctx.tenantId, cmd.commandId, b.deviceId, ctx.userId, cmd.type, cmd.observedVersion ?? null, cmd.deviceTime, status, JSON.stringify(result)]);
        return { commandId: cmd.commandId, status, replay: false, ...result };
      }));
    }
    return { results };
  }
  private async apply(tx: Tx, ctx: RequestContext, deviceId: string, cmd: any): Promise<Record<string, unknown>> {
    if (cmd.type === 'capture_pod') {
      const p = cmd.payload;
      const stop = await tx.maybe(`SELECT * FROM transport.trip_stops WHERE id=$1 FOR UPDATE`, [p.tripStopId]);
      if (!stop) throw new DomainError('NOT_FOUND', 'Stop not found.');
      if (stop.status === 'done') throw new DomainError('INVALID_STATE_TRANSITION', 'This stop already has proof of delivery.');
      await tx.q(`INSERT INTO transport.proofs_of_delivery(tenant_id, trip_stop_id, signed_by, captured_at, device_id, document_id, command_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [ctx.tenantId, p.tripStopId, p.signedBy, cmd.deviceTime, deviceId, p.documentId ?? null, cmd.commandId]);
      await tx.q(`UPDATE transport.trip_stops SET status='done' WHERE id=$1`, [p.tripStopId]);
      if (stop.shipment_id) await tx.q(`INSERT INTO logistics.tracking_events(tenant_id, shipment_id, code, event_time, source, is_actual, external_event_id) VALUES ($1,$2,'POD_CAPTURED',$3,'device',true,$4) ON CONFLICT DO NOTHING`, [ctx.tenantId, stop.shipment_id, cmd.deviceTime, cmd.commandId]);
      // Evidence captured ≠ delivery completed: completion is an online command that validates the approved POD document.
      return { evidence: 'pod_captured', note: 'Delivery completion requires online validation.' };
    }
    return { evidence: cmd.type };
  }
}
@Controller() export class TransportController { constructor(@Inject(TransportService) private s: TransportService) {} @Op('syncDeviceCommands') sync(@Ctx() c: RequestContext, @Body() b: any) { return this.s.sync(c, b); }
  @Op('listTrips') lt(@Ctx() c: RequestContext) { return this.s.listTrips(c); } @Op('createTrip') ct(@Ctx() c: RequestContext, @Body() b: any) { return this.s.createTrip(c, b); } @Op('dispatchTrip') dt(@Ctx() c: RequestContext, @Param('id') id: string) { return this.s.dispatchTrip(c, id); } }
@Module({ imports: [PeopleModule], providers: [TransportService], controllers: [TransportController] }) export class TransportModule {}
