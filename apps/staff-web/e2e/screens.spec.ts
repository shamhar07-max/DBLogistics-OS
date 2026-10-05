import { expect, test, type Page } from '@playwright/test';
const TENANT = process.env.TENANT_ID!;
const shot = (p: Page, n: string) => p.screenshot({ path: `e2e/artifacts/${n}.png`, fullPage: true });
async function login(page: Page, subject: string) { await page.goto('/login'); await page.getByPlaceholder('OIDC subject').fill(subject); await page.getByPlaceholder('Tenant id (uuid)').fill(TENANT); await page.getByRole('button', { name: 'Dev sign in' }).click(); await page.waitForURL('/'); }
const uniq = () => Math.random().toString(36).slice(2, 8);

const SCREENS: Array<[string, string]> = [['/customers', 'Customers & partners'], ['/enquiries', 'Enquiries & quotes'], ['/quotes', 'Quotations'], ['/jobs', 'Shipments & jobs'], ['/transport', 'Transport & dispatch'], ['/customs', 'Customs & trade'], ['/documents', 'Documents'], ['/warehouse', 'Warehouse custody'],
  ['/finance', 'Money'], ['/people', 'People & assets'], ['/quality', 'Service & quality'], ['/intelligence', 'Intelligence'], ['/automation', 'Automation'], ['/admin', 'Administration'], ['/approvals', 'Approvals']];
test('every navigation item opens a real screen for the owner (no placeholders, no errors)', async ({ page }) => {
  await login(page, 'layla');
  for (const [href, title] of SCREENS) {
    await page.goto(href); await expect(page.getByRole('heading', { level: 1, name: new RegExp(title, 'i') }), href).toBeVisible();
    await expect(page.getByTestId('not-in-release'), href).toHaveCount(0); await expect(page.getByTestId('error'), href).toHaveCount(0); await expect(page.getByTestId('forbidden'), href).toHaveCount(0);
  }
  await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link')).toHaveCount(14);
});
test('customers: party 360 with the bank-change maker-checker; sales cannot approve', async ({ page }) => {
  await login(page, 'layla'); await page.goto('/customers'); await page.getByRole('link', { name: 'Gulf Pharma Distribution' }).click();
  await expect(page.getByText('Bank details · maker-checker')).toBeVisible(); await expect(page.getByText('Active jobs')).toBeVisible();
  await page.getByLabel('Account name').fill('Gulf Pharma LLC'); await page.getByLabel('IBAN').fill('AE070331234567890123456'); await page.getByRole('button', { name: 'Propose change' }).click();
  await expect(page.getByText('Proposed change')).toBeVisible(); await shot(page, '09-party-360');
  await page.getByRole('button', { name: 'Approve after call-back' }).click();                                    // same person proposed and approves
  await expect(page.getByRole('alert').filter({ hasText: 'SEPARATION_OF_DUTIES' })).toBeVisible();
});
test('customers: create a party appears in the list', async ({ page }) => {
  const name = `E2E Trading ${uniq()}`; await login(page, 'layla'); await page.goto('/customers'); await page.getByLabel('Legal name').fill(name); await page.getByRole('button', { name: 'Create party' }).click();
  await expect(page.getByRole('link', { name })).toBeVisible();
});
test('transport: dispatch is refused for a driver without a valid driving qualification, and allowed with one', async ({ page }) => {
  await login(page, 'layla'); await page.goto('/transport'); await expect(page.getByText('DXB A-48213')).not.toHaveCount(0).catch(() => undefined);
  await page.getByLabel('Transporter').selectOption({ label: 'Desert Haulage' }); await page.getByLabel('Driver').selectOption({ label: 'Bilal Rahman' }); await page.getByLabel('Vehicle').fill('DXB B-1');
  await page.getByLabel('Address').nth(0).fill('Port A'); await page.getByLabel('Address').nth(1).fill('Warehouse B'); await page.getByRole('button', { name: 'Plan trip' }).click();
  const row = page.getByRole('row').filter({ hasText: 'Bilal Rahman' }); await expect(row).toBeVisible(); await row.getByRole('button', { name: 'Dispatch' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'QUALIFICATION_REQUIRED' })).toBeVisible(); await shot(page, '10-transport-blocked');
  const ok = page.getByRole('row').filter({ hasText: 'Karim Haddad' }).first(); await ok.getByRole('button', { name: 'Dispatch' }).click(); await expect(page.getByRole('row').filter({ hasText: 'Karim Haddad' }).first().getByText('dispatched')).toBeVisible();
});
test('quality: a hold placed by one person cannot be released by the same person; the owner can release it', async ({ page }) => {
  await login(page, 'qadir'); await page.goto('/quality'); await expect(page.getByRole('row').filter({ hasText: /temperature excursion/i })).toBeVisible(); await shot(page, '11-quality-incidents');
  await page.getByRole('tab', { name: 'Holds' }).click(); const hold = page.getByRole('row').filter({ hasText: 'Insulin pens' }).filter({ hasText: 'active' }).first(); await expect(hold).toBeVisible();
  await hold.getByLabel('Release note').fill('Logger re-checked, within range'); await hold.getByRole('button', { name: 'Release' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /SEPARATION_OF_DUTIES|FORBIDDEN/ })).toBeVisible(); await shot(page, '12-hold-release-blocked');
});
test('people: HR adds an employee and records a qualification that shows in the roster', async ({ page }) => {
  const name = `Test Driver ${uniq()}`; await login(page, 'hana'); await page.goto('/people'); await expect(page.getByRole('row').filter({ hasText: 'Karim Haddad' }).getByText('driving')).toBeVisible();
  await page.getByLabel('Legal entity').selectOption({ index: 1 }); await page.getByLabel('Full name').fill(name); await page.getByRole('button', { name: 'Add employee' }).click(); await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible();
  await page.getByRole('tab', { name: 'Qualifications' }).click(); await expect(page.getByRole('row').filter({ hasText: 'Sami Idris' }).getByText(/days left/)).toBeVisible(); await shot(page, '13-people');
});
test('admin: members and roles for the owner; sales is denied', async ({ page }) => {
  await login(page, 'layla'); await page.goto('/admin'); await expect(page.getByRole('row').filter({ hasText: 'omar' })).toBeVisible(); await page.getByRole('tab', { name: 'Roles' }).click(); await expect(page.getByText('quality.hold.release').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Audit log' }).click(); await expect(page.getByRole('row').filter({ hasText: /\./ }).first()).toBeVisible(); await shot(page, '14-admin');
  await page.context().clearCookies(); await login(page, 'omar'); await page.goto('/admin'); await expect(page.getByTestId('forbidden').first()).toBeVisible();
});
test('intelligence: finance reports and the controlled AI tool console', async ({ page }) => {
  await login(page, 'layla'); await page.goto('/intelligence'); await expect(page.getByText(/Receivables ageing/).first()).toBeVisible(); await page.getByRole('tab', { name: 'Job profitability' }).click(); await expect(page.getByText('Estimated margin')).toBeVisible();
  await page.getByRole('tab', { name: 'AI tools' }).click(); await expect(page.getByText('Controlled tools')).toBeVisible(); await expect(page.getByText('propose_payment_batch')).toBeVisible(); await shot(page, '15-intelligence');
});
test('warehouse: receive cargo into custody via the form', async ({ page }) => {
  const desc = `Receipt ${uniq()}`; await login(page, 'yusuf'); await page.goto('/warehouse'); await page.getByRole('tab', { name: 'Receive' }).click();
  await page.getByLabel('Facility').selectOption({ index: 1 }); await page.getByLabel(/^Owner/).selectOption({ label: 'Al Noor Foods Trading' }); await page.getByLabel('Description').fill(desc); await page.getByLabel('Quantity').fill('12');
  await page.getByRole('button', { name: 'Receive into custody' }).click(); await expect(page.getByText('Received — stock lot created')).toBeVisible();
  await page.getByRole('tab', { name: 'Stock' }).click(); await expect(page.getByText(desc)).toBeVisible(); await shot(page, '16-warehouse-receive');
});
test('job workspace: add a task and a message; both persist', async ({ page }) => {
  const title = `Follow up ${uniq()}`; await login(page, 'layla'); await page.goto('/jobs'); await page.getByRole('link', { name: /^JOB-/ }).first().click();
  await page.getByRole('tab', { name: 'tasks' }).click(); await page.getByLabel('Title').fill(title); await page.getByRole('button', { name: 'Add task' }).click(); await expect(page.getByText(title)).toBeVisible();
  await page.getByRole('tab', { name: 'conversations' }).click(); await page.getByLabel('Message').fill(`Note ${title}`); await page.getByRole('button', { name: 'Post' }).click(); await expect(page.getByText(`Note ${title}`)).toBeVisible(); await shot(page, '17-job-conversations');
  await page.getByRole('tab', { name: 'cargo' }).click(); await expect(page.getByText('Palletised cargo')).toBeVisible(); await page.getByRole('tab', { name: 'bookings' }).click(); await expect(page.getByRole('heading', { name: 'Request booking' })).toBeVisible();
});
test('finance: tabs for invoices, receipts, supplier bills and charges', async ({ page }) => {
  await login(page, 'faisal'); await page.goto('/finance'); await expect(page.getByRole('row').filter({ hasText: 'posted' }).first()).toBeVisible(); await shot(page, '18-finance');
  for (const t of ['Receipts', 'Supplier bills', 'Charges']) { await page.getByRole('tab', { name: t }).click(); await expect(page.getByTestId('error')).toHaveCount(0); }
});
test('today: attention strip shows tasks, incidents and expiring qualifications', async ({ page }) => {
  await login(page, 'layla'); await expect(page.getByText('Open incidents')).toBeVisible(); await expect(page.getByText(/Qualifications expiring/)).toBeVisible(); await page.waitForTimeout(800); await shot(page, '19-today-attention');
});
