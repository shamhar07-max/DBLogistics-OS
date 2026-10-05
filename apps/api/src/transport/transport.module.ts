import { Body, Controller, Inject, Injectable, Module } from '@nestjs/common';
import { Ctx, Db, DomainError, Op, type RequestContext, type Tx } from '../platform';

/** Offline-first device sync: each command carries commandId/device/actor/observed version/device time; server receipt time is stored separately. */
@Injectable()
export class TransportService {
  constructor(@Inject(Db) private db: Db) {}
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
@Controller() export class TransportController { constructor(@Inject(TransportService) private s: TransportService) {} @Op('syncDeviceCommands') sync(@Ctx() c: RequestContext, @Body() b: any) { return this.s.sync(c, b); } }
@Module({ providers: [TransportService], controllers: [TransportController] }) export class TransportModule {}
