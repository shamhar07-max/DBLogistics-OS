import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { close, world, type World } from './helpers';

let w: World;
beforeAll(async () => { w = await world(); });
afterAll(async () => close(w));
const key = () => `wf-${randomUUID().slice(0, 6)}`;
const good = { conditions: [{ field: 'payload.amount', op: 'gt', value: 100 }], actions: [{ type: 'create_task', title: 'Review {{payload.jobRef}}', dueInHours: 24 }, { type: 'wait', seconds: 60 }, { type: 'notify', channel: 'internal', template: 'followup' }] };

describe('workflow definitions', () => {
  it('rejects unknown topics, unknown actions, oversize waits, bad paths and a trailing wait — nothing is stored', async () => {
    const bad = async (body: any) => (await w.owner.post('/workflows', body)).status;
    const k = key();
    expect(await bad({ key: k, triggerTopic: 'NopeHappened', definition: good })).toBe(422);
    expect(await bad({ key: k, triggerTopic: 'JobClosed', definition: { actions: [{ type: 'delete_everything' }] } })).toBe(422);
    expect(await bad({ key: k, triggerTopic: 'JobClosed', definition: { actions: [{ type: 'wait', seconds: 99999999 }, { type: 'notify', channel: 'internal', template: 'x1' }] } })).toBe(422);
    expect(await bad({ key: k, triggerTopic: 'JobClosed', definition: { conditions: [{ field: 'secret.password', op: 'eq', value: 'x' }], actions: [{ type: 'notify', channel: 'internal', template: 'x1' }] } })).toBe(422);
    expect(await bad({ key: k, triggerTopic: 'JobClosed', definition: { actions: [{ type: 'create_task', title: 'Do it' }, { type: 'wait', seconds: 5 }] } })).toBe(422);
    expect(await bad({ key: 'Bad Key!', triggerTopic: 'JobClosed', definition: good })).toBe(422);
    expect((await w.su.query(`SELECT count(*)::int n FROM automation.workflow_definitions WHERE key=$1`, [k])).rows[0].n).toBe(0);
  });
  it('publishes versions; only a draft can be activated; one active version per key; retire; published definitions are immutable', async () => {
    const k = key(); const v1 = await w.owner.post('/workflows', { key: k, triggerTopic: 'JobClosed', description: 'first', definition: good }); expect(v1.status).toBe(201); expect(v1.body.version).toBe(1);
    const v2 = await w.owner.post('/workflows', { key: k, triggerTopic: 'JobClosed', definition: good }); expect(v2.body.version).toBe(2);
    expect((await w.owner.post(`/workflows/${v1.body.id}/activate`)).status).toBe(200);
    expect((await w.owner.post(`/workflows/${v1.body.id}/activate`)).body.code).toBe('INVALID_STATE_TRANSITION');                       // already active
    expect((await w.owner.post(`/workflows/${v2.body.id}/activate`)).status).toBe(200);                                                 // retires v1
    const states = (await w.owner.get('/workflows')).body.filter((x: any) => x.key === k).map((x: any) => `${x.version}:${x.status}`).sort(); expect(states).toEqual(['1:retired', '2:active']);
    expect((await w.owner.post(`/workflows/${v1.body.id}/activate`)).body.code).toBe('INVALID_STATE_TRANSITION');                       // a retired version is never revived
    await expect(w.su.query(`UPDATE automation.workflow_definitions SET definition='{"actions":[]}' WHERE id=$1`, [v2.body.id])).rejects.toThrow(/immutable/);
    await expect(w.su.query(`UPDATE automation.workflow_definitions SET status='draft' WHERE id=$1`, [v2.body.id])).rejects.toThrow(/Invalid workflow status/);
    await expect(w.su.query(`INSERT INTO automation.workflow_definitions(tenant_id,key,version,trigger_topic,definition,status,owner_user_id) VALUES ($1,$2,9,'JobClosed','{"actions":[]}','active',$3)`, [w.a.tenantId, k, randomUUID()])).rejects.toThrow(/workflow_one_active_version/);
    expect((await w.owner.post(`/workflows/${v2.body.id}/retire`)).status).toBe(200); expect((await w.owner.post(`/workflows/${v2.body.id}/retire`)).body.code).toBe('INVALID_STATE_TRANSITION');
    expect((await w.su.query(`SELECT count(*)::int n FROM platform.audit_events WHERE action IN ('workflow.created','workflow.activated','workflow.retired') AND detail->>'key'=$1`, [k])).rows[0].n).toBe(5);
  });
  it('runs: failed runs can be retried and non-terminal runs cancelled, through the API only when the state allows it; viewers without automation.manage are refused', async () => {
    const k = key(); const d = await w.owner.post('/workflows', { key: k, triggerTopic: 'JobClosed', definition: good });
    const runId = async (status: string) => (await w.su.query(`INSERT INTO automation.workflow_runs(tenant_id, definition_id, trigger_event_id, status, state, last_error) VALUES ($1,$2,$3,$4,'{"index":0}','boom') RETURNING id`, [w.a.tenantId, d.body.id, Math.floor(Math.random() * 1e9), status])).rows[0].id as string;
    const failed = await runId('failed'); const done = await runId('completed'); const waiting = await runId('waiting');
    expect((await w.owner.post(`/workflow-runs/${done}/retry`)).body.code).toBe('INVALID_STATE_TRANSITION'); expect((await w.owner.post(`/workflow-runs/${done}/cancel`)).body.code).toBe('INVALID_STATE_TRANSITION');
    const r = await w.owner.post(`/workflow-runs/${failed}/retry`); expect(r.body.status).toBe('waiting');
    expect((await w.su.query(`SELECT status, resume_at IS NOT NULL AS due FROM automation.workflow_runs WHERE id=$1`, [failed])).rows[0]).toEqual({ status: 'waiting', due: true });         // back on the durable timer
    expect((await w.owner.post(`/workflow-runs/${waiting}/cancel`)).body.status).toBe('cancelled');
    const detail = await w.owner.get(`/workflow-runs/${waiting}`); expect(detail.body.log.at(-1).note).toMatch(/Cancelled/); expect(detail.body.definition.actions).toHaveLength(3);
    expect((await w.owner.get('/workflow-runs?status=cancelled')).body.map((x: any) => x.id)).toContain(waiting);
    expect((await w.owner.get('/workflow-runs?status=bogus')).status).toBe(422);
    const sales = await w.member(w.a.tenantId, `s${randomUUID().slice(0, 4)}`, ['sales']); expect((await sales.get('/workflows')).status).toBe(403); expect((await sales.post(`/workflow-runs/${failed}/cancel`)).status).toBe(403);
  });
});

describe('facilities and locations', () => {
  it('admins create facilities and locations; duplicates are refused; others cannot', async () => {
    const f = await w.owner.post('/facilities', { legalEntityId: w.a.legalEntityId, name: `Cold store ${randomUUID().slice(0, 4)}`, kind: 'warehouse' }); expect(f.status).toBe(201);
    expect((await w.owner.post('/facilities', { legalEntityId: w.a.legalEntityId, name: f.body.name.toUpperCase(), kind: 'yard' })).body.code).toBe('DUPLICATE');
    expect((await w.owner.post(`/facilities/${f.body.id}/locations`, { code: 'A-01', zone: 'Chilled' })).status).toBe(201);
    expect((await w.owner.post(`/facilities/${f.body.id}/locations`, { code: 'A-01' })).body.code).toBe('DUPLICATE');
    const list = (await w.owner.get('/facilities')).body.find((x: any) => x.id === f.body.id); expect(list.locations).toEqual([expect.objectContaining({ code: 'A-01', zone: 'Chilled' })]); expect(list.legal_entity).toBeTruthy();
    const wh = await w.member(w.a.tenantId, `wh${randomUUID().slice(0, 4)}`, ['warehouse_operator']); expect((await wh.post('/facilities', { legalEntityId: w.a.legalEntityId, name: 'Nope', kind: 'yard' })).status).toBe(403);
    expect((await w.owner.post('/facilities', { legalEntityId: randomUUID(), name: 'Ghost', kind: 'yard' })).body.code).toBe('NOT_FOUND');
  });
});
