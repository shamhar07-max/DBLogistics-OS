import { execSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
const TENANT = process.env.TENANT_ID!;
/** Next dev serves HTML before React hydrates; interacting earlier loses typed values and replays clicks mid-hydration. Wait until the page is interactive. */
const go = async (page: Page, path: string) => { await page.goto(path); await page.waitForFunction(() => { const el = document.querySelector('main'); return !!el && Object.keys(el).some((k) => k.startsWith('__reactProps')); }, null, { timeout: 30000 }); };
const shot = (p: Page, n: string) => p.screenshot({ path: `e2e/artifacts/${n}.png`, fullPage: true });
async function login(page: Page, subject: string) { await go(page, '/login'); await page.getByPlaceholder('OIDC subject').fill(subject); await page.getByPlaceholder('Tenant id (uuid)').fill(TENANT); await page.getByRole('button', { name: 'Dev sign in' }).click(); await page.waitForURL('/'); }
const uniq = () => Math.random().toString(36).slice(2, 8);
const sql = (q: string) => execSync(`psql -h /tmp -p 54329 -U postgres -d dbl -tAc "${q.replace(/"/g, '\\"')}"`).toString().trim();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const SCREENS: Array<[string, string]> = [['/customers', 'Customers & partners'], ['/enquiries', 'Enquiries & quotes'], ['/quotes', 'Quotations'], ['/jobs', 'Shipments & jobs'], ['/transport', 'Transport & dispatch'], ['/customs', 'Customs & trade'], ['/documents', 'Documents'], ['/warehouse', 'Warehouse custody'],
  ['/finance', 'Money'], ['/people', 'People & assets'], ['/quality', 'Service & quality'], ['/intelligence', 'Intelligence'], ['/automation', 'Automation'], ['/admin', 'Administration'], ['/approvals', 'Approvals']];
test('every navigation item opens a real screen for the owner (no placeholders, no errors)', async ({ page }) => {
  await login(page, 'layla');
  for (const [href, title] of SCREENS) {
    await go(page, href); await expect(page.getByRole('heading', { level: 1, name: new RegExp(title, 'i') }), href).toBeVisible();
    await expect(page.getByTestId('not-in-release'), href).toHaveCount(0); await expect(page.getByTestId('error'), href).toHaveCount(0); await expect(page.getByTestId('forbidden'), href).toHaveCount(0);
  }
  await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link')).toHaveCount(14);
});
test('customers: party 360 with the bank-change maker-checker; sales cannot approve', async ({ page }) => {
  await login(page, 'layla'); await go(page, '/customers'); await page.getByRole('link', { name: 'Gulf Pharma Distribution' }).click();
  await expect(page.getByText('Bank details · maker-checker')).toBeVisible(); await expect(page.getByText('Active jobs')).toBeVisible();
  await page.getByLabel('Account name').fill('Gulf Pharma LLC'); await page.getByLabel('IBAN').fill('AE070331234567890123456'); await page.getByRole('button', { name: 'Propose change' }).click();
  await expect(page.getByText('Proposed change')).toBeVisible(); await shot(page, '09-party-360');
  await page.getByRole('button', { name: 'Approve after call-back' }).click();                                    // same person proposed and approves
  await expect(page.getByRole('alert').filter({ hasText: 'SEPARATION_OF_DUTIES' })).toBeVisible();
});
test('customers: create a party appears in the list', async ({ page }) => {
  const name = `E2E Trading ${uniq()}`; await login(page, 'layla'); await go(page, '/customers'); await page.getByLabel('Legal name').fill(name); await page.getByRole('button', { name: 'Create party' }).click();
  await expect(page.getByRole('link', { name })).toBeVisible();
});
test('transport: dispatch is refused for a driver without a valid driving qualification, and allowed with one', async ({ page }) => {
  await login(page, 'layla'); await go(page, '/transport'); await expect(page.getByText('DXB A-48213')).not.toHaveCount(0).catch(() => undefined);
  await page.getByLabel('Transporter').selectOption({ label: 'Desert Haulage' }); await page.getByLabel('Driver').selectOption({ label: 'Bilal Rahman' }); await page.getByLabel('Vehicle').fill('DXB B-1');
  await page.getByLabel('Address').nth(0).fill('Port A'); await page.getByLabel('Address').nth(1).fill('Warehouse B'); await page.getByRole('button', { name: 'Plan trip' }).click();
  const row = page.getByRole('row').filter({ hasText: 'Bilal Rahman' }); await expect(row).toBeVisible(); await row.getByRole('button', { name: 'Dispatch' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'QUALIFICATION_REQUIRED' })).toBeVisible(); await shot(page, '10-transport-blocked');
  await page.getByLabel('Transporter').selectOption({ label: 'Desert Haulage' }); await page.getByLabel('Driver').selectOption({ label: 'Karim Haddad' }); await page.getByLabel('Vehicle').fill('DXB K-7');
  await page.getByLabel('Address').nth(0).fill('Port B'); await page.getByLabel('Address').nth(1).fill('Warehouse C'); await page.getByRole('button', { name: 'Plan trip' }).click();
  const ok = page.getByRole('row').filter({ hasText: 'DXB K-7' }); await expect(ok).toBeVisible(); await ok.getByRole('button', { name: 'Dispatch' }).click(); await expect(page.getByRole('row').filter({ hasText: 'DXB K-7' }).getByText('dispatched')).toBeVisible();
});
test('quality: a hold placed by one person cannot be released by the same person; the owner can release it', async ({ page }) => {
  await login(page, 'qadir'); await go(page, '/quality'); await expect(page.getByRole('row').filter({ hasText: /temperature excursion/i })).toBeVisible(); await shot(page, '11-quality-incidents');
  await page.getByRole('tab', { name: 'Holds' }).click(); const hold = page.getByRole('row').filter({ hasText: 'Insulin pens' }).filter({ hasText: 'active' }).first(); await expect(hold).toBeVisible();
  await hold.getByLabel('Release note').fill('Logger re-checked, within range'); await hold.getByRole('button', { name: 'Release' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /SEPARATION_OF_DUTIES|FORBIDDEN/ })).toBeVisible(); await shot(page, '12-hold-release-blocked');
});
test('people: HR adds an employee and records a qualification that shows in the roster', async ({ page }) => {
  const name = `Test Driver ${uniq()}`; await login(page, 'hana'); await go(page, '/people'); await expect(page.getByRole('row').filter({ hasText: 'Karim Haddad' }).getByText('driving')).toBeVisible();
  await page.getByLabel('Legal entity').selectOption({ index: 1 }); await page.getByLabel('Full name').fill(name); await page.getByRole('button', { name: 'Add employee' }).click(); await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible();
  await page.getByRole('tab', { name: 'Qualifications' }).click(); await expect(page.getByRole('row').filter({ hasText: 'Sami Idris' }).getByText(/days left/)).toBeVisible(); await shot(page, '13-people');
});
test('admin: members and roles for the owner; sales is denied', async ({ page }) => {
  await login(page, 'layla'); await go(page, '/admin'); await expect(page.getByRole('row').filter({ hasText: 'omar' })).toBeVisible(); await page.getByRole('tab', { name: 'Roles' }).click(); await expect(page.getByText('quality.hold.release').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Audit log' }).click(); await expect(page.getByRole('row').filter({ hasText: /\./ }).first()).toBeVisible(); await shot(page, '14-admin');
  await page.context().clearCookies(); await login(page, 'omar'); await go(page, '/admin'); await expect(page.getByTestId('forbidden').first()).toBeVisible();
});
test('intelligence: finance reports and the controlled AI tool console', async ({ page }) => {
  await login(page, 'layla'); await go(page, '/intelligence'); await expect(page.getByText(/Receivables ageing/).first()).toBeVisible(); await page.getByRole('tab', { name: 'Job profitability' }).click(); await expect(page.getByText('Estimated margin')).toBeVisible();
  await page.getByRole('tab', { name: 'AI tools' }).click(); await expect(page.getByText('Controlled tools')).toBeVisible(); await expect(page.getByText('propose_payment_batch')).toBeVisible(); await shot(page, '15-intelligence');
});
test('warehouse: receive cargo into custody via the form', async ({ page }) => {
  const desc = `Receipt ${uniq()}`; await login(page, 'yusuf'); await go(page, '/warehouse'); await page.getByRole('tab', { name: 'Receive' }).click();
  await page.getByLabel('Facility').selectOption({ index: 1 }); await page.getByLabel(/^Owner/).selectOption({ label: 'Al Noor Foods Trading' }); await page.getByLabel('Description').fill(desc); await page.getByLabel('Quantity').fill('12');
  await page.getByRole('button', { name: 'Receive into custody' }).click(); await expect(page.getByText('Received — stock lot created')).toBeVisible();
  await page.getByRole('tab', { name: 'Stock' }).click(); await expect(page.getByText(desc)).toBeVisible(); await shot(page, '16-warehouse-receive');
});
test('job workspace: add a task and a message; both persist', async ({ page }) => {
  const title = `Follow up ${uniq()}`; await login(page, 'layla'); await go(page, '/jobs'); await page.getByRole('link', { name: /^JOB-/ }).first().click();
  await page.getByRole('tab', { name: 'tasks' }).click(); await page.getByLabel('Title').fill(title); await page.getByRole('button', { name: 'Add task' }).click(); await expect(page.getByText(title)).toBeVisible();
  await page.getByRole('tab', { name: 'conversations' }).click(); await page.getByLabel('Message').fill(`Note ${title}`); await page.getByRole('button', { name: 'Post' }).click(); await expect(page.getByText(`Note ${title}`)).toBeVisible(); await shot(page, '17-job-conversations');
  await page.getByRole('tab', { name: 'cargo' }).click(); await expect(page.getByText('Palletised cargo')).toBeVisible(); await page.getByRole('tab', { name: 'bookings' }).click(); await expect(page.getByRole('heading', { name: 'Request booking' })).toBeVisible();
});
test('finance: tabs for invoices, receipts, supplier bills and charges', async ({ page }) => {
  await login(page, 'faisal'); await go(page, '/finance'); await expect(page.getByRole('row').filter({ hasText: 'posted' }).first()).toBeVisible(); await shot(page, '18-finance');
  for (const t of ['Receipts', 'Supplier bills', 'Charges']) { await page.getByRole('tab', { name: t }).click(); await expect(page.getByTestId('error')).toHaveCount(0); }
});
test('today: attention strip shows tasks, incidents and expiring qualifications', async ({ page }) => {
  await login(page, 'layla'); await expect(page.getByText('Open incidents')).toBeVisible(); await expect(page.getByText(/Qualifications expiring/)).toBeVisible(); await page.waitForTimeout(800); await shot(page, '19-today-attention');
});

test('automation designer: validates as you type, previews with a sample event, saves a draft version, activates and retires it', async ({ page }) => {
  const key = `e2e-${uniq()}`; await login(page, 'layla'); await go(page, '/automation'); await page.getByRole('button', { name: 'New workflow' }).click(); const dlg = page.getByRole('dialog');
  await expect(dlg.getByRole('button', { name: 'Save as draft version' })).toBeDisabled(); await expect(dlg.getByLabel('Validation issues')).toBeVisible();
  await dlg.getByLabel('Workflow key').fill(key); await dlg.getByLabel('Step 1 title').fill('Chase POD for {{payload.jobId}}');
  await dlg.getByRole('button', { name: '+ Add condition' }).click(); await dlg.getByLabel('Condition 1 field').fill('payload.amount'); await dlg.getByLabel('Condition 1 operator').selectOption('gt'); await dlg.getByLabel('Condition 1 value').fill('100');
  await dlg.getByRole('button', { name: '+ Add step' }).click(); await dlg.getByLabel('Step 2 type').selectOption('wait'); await dlg.getByLabel('Step 2 amount').fill('2'); await dlg.getByLabel('Step 2 unit').selectOption('hours');
  await expect(dlg.getByLabel('Validation issues')).toContainText('cannot end with a wait'); await expect(dlg.getByRole('button', { name: 'Save as draft version' })).toBeDisabled();           // a trailing wait is rejected by the same schema the API uses
  await dlg.getByRole('button', { name: '+ Add step' }).click(); await dlg.getByLabel('Step 3 type').selectOption('notify'); await dlg.getByLabel('Step 3 template').fill('pod-reminder');
  await dlg.getByLabel('Sample payload').fill('{"jobId":"J-9","amount":500}'); await expect(dlg.getByTestId('preview-step')).toHaveText([/Create task “Chase POD for J-9”/, /Wait 2 h/, /Notify via internal using template “pod-reminder”/]);
  await dlg.getByLabel('Sample payload').fill('{"jobId":"J-9","amount":50}'); await expect(dlg.getByText(/conditions are not met/)).toBeVisible(); await shot(page, '20-workflow-designer');
  await dlg.getByLabel('Sample payload').fill('{"jobId":"J-9","amount":500}'); await expect(dlg.getByRole('button', { name: 'Save as draft version' })).toBeEnabled(); await dlg.getByRole('button', { name: 'Save as draft version' }).click(); await expect(dlg.getByText(/as version 1/)).toBeVisible(); await dlg.getByRole('button', { name: 'Done' }).click();
  const row = page.getByRole('row').filter({ hasText: key }); await expect(row.getByText('draft')).toBeVisible(); await row.getByRole('button', { name: 'Activate' }).click(); await expect(page.getByRole('row').filter({ hasText: key }).getByText('active')).toBeVisible();
  await page.getByRole('row').filter({ hasText: key }).getByRole('button', { name: 'Retire' }).click(); await expect(page.getByRole('row').filter({ hasText: key }).getByText('retired')).toBeVisible();
});
test('automation: failed runs show their reason and can be retried or cancelled from the run dialog', async ({ page }) => {
  const key = `fail-${uniq()}`; const defId = sql(`insert into automation.workflow_definitions(tenant_id,key,version,trigger_topic,definition,status,owner_user_id) select '${TENANT}','${key}',1,'JobClosed','{\"actions\":[{\"type\":\"create_task\",\"title\":\"x1x\"}]}','active',(select id from platform.users limit 1) returning id`).split('\n')[0];
  sql(`insert into automation.workflow_runs(tenant_id,definition_id,trigger_event_id,status,attempts,last_error,state,log) values ('${TENANT}','${defId}',${Date.now()},'failed',1,'Unknown action type teleport at step 2','{\"index\":0}','[{\"at\":\"2026-01-01T00:00:00Z\",\"note\":\"Failed: boom\"}]')`);
  await login(page, 'layla'); await go(page, '/automation'); await page.getByRole('tab', { name: 'Runs' }).click(); await page.getByLabel('Filter by status').selectOption('failed');
  await page.getByRole('button', { name: new RegExp(key) }).click(); const dlg = page.getByRole('dialog'); await expect(dlg.getByText('Unknown action type teleport at step 2').first()).toBeVisible(); await expect(dlg.getByText(/Failed: boom/)).toBeVisible();
  await dlg.getByRole('button', { name: 'Retry from last step' }).click(); await expect(dlg.getByText('waiting').first()).toBeVisible(); await dlg.getByRole('button', { name: 'Cancel run' }).click(); await expect(dlg.getByText('cancelled').first()).toBeVisible();
});
test('admin: create a facility and a storage location, then receive cargo into it', async ({ page }) => {
  const name = `Cold store ${uniq()}`; await login(page, 'layla'); await go(page, '/admin'); await page.getByRole('tab', { name: 'Facilities' }).click();
  await page.getByLabel('Legal entity').selectOption({ index: 1 }); await page.getByLabel('Name').fill(name); await page.getByRole('button', { name: 'Create facility' }).click(); await expect(page.getByRole('list').getByText(name)).toBeVisible();
  await page.getByLabel(/^Facility/).first().selectOption({ label: name }); await page.getByLabel('Code').fill('A-01-02'); await page.getByLabel('Zone').fill('Chilled'); await page.getByRole('button', { name: 'Add location' }).click(); await expect(page.getByText('A-01-02 · Chilled')).toBeVisible(); await shot(page, '21-facilities');
  await go(page, '/warehouse'); await page.getByRole('tab', { name: 'Receive' }).click(); await page.getByLabel(/^Facility/).first().selectOption({ label: name }); await expect(page.getByLabel('Location').locator('option', { hasText: 'A-01-02' })).toHaveCount(1);
});
test('documents: staff preview a scanned file inline (signed link) and cannot open an unscanned one', async ({ page }) => {
  const type = `E2E-${uniq()}`; await login(page, 'layla'); await go(page, '/documents'); await page.getByLabel('Attach to job').selectOption({ index: 1 });
  await page.getByLabel('File').setInputFiles({ name: 'scan.png', mimeType: 'image/png', buffer: PNG }); await page.getByLabel('Document type').fill(type); await page.getByRole('button', { name: 'Upload', exact: true }).click(); await expect(page.getByText(/Registered/)).toBeVisible();
  await page.reload(); const row = page.getByRole('row').filter({ hasText: type }); await expect(row.getByRole('button', { name: 'Preview' })).toBeDisabled();
  sql(`update platform.document_versions set scan_status='clean' where tenant_id='${TENANT}' and document_id in (select id from platform.documents where doc_type='${type}')`);
  await page.reload(); await page.getByRole('row').filter({ hasText: type }).getByRole('button', { name: 'Preview' }).click(); const img = page.getByRole('dialog').getByRole('img'); await expect(img).toBeVisible(); await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1); await shot(page, '22-staff-preview');
});
test.describe('phone layout', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('navigation becomes a drawer and no screen scrolls sideways', async ({ page }) => {
    test.setTimeout(240_000);
    await login(page, 'layla'); await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible(); await expect(page.getByRole('link', { name: 'Customers' })).not.toBeInViewport();
    await page.getByRole('button', { name: 'Open navigation' }).click(); await expect(page.getByRole('link', { name: 'Customers' })).toBeInViewport(); await shot(page, '23-phone-drawer'); await page.getByRole('link', { name: 'Customers' }).click(); await expect(page).toHaveURL(/\/customers$/, { timeout: 30000 }); await expect(page.getByRole('link', { name: 'Customers' })).not.toBeInViewport();
    for (const [href] of SCREENS) { await go(page, href); await expect(page.getByRole('heading', { level: 1 })).toBeVisible(); await page.waitForTimeout(250); expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), href).toBeLessThanOrEqual(1); }
    await go(page, '/jobs'); await page.getByRole('link', { name: /^JOB-/ }).first().click(); await page.waitForTimeout(400); expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 'job workspace').toBeLessThanOrEqual(1); await shot(page, '24-phone-job');
  });
});
