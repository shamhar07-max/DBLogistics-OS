import { expect, test, type Page } from '@playwright/test';
const TENANT = process.env.TENANT_ID!;
const shot = (p: Page, n: string) => p.screenshot({ path: `e2e/artifacts/${n}.png`, fullPage: true });
async function login(page: Page, subject: string) { await page.goto('/login'); await page.getByPlaceholder('OIDC subject').fill(subject); await page.getByPlaceholder('Tenant id (uuid)').fill(TENANT); await page.getByRole('button', { name: 'Dev sign in' }).click(); await page.waitForURL('/'); }

test('unauthenticated users are sent to login; the master logo is shown', async ({ page }) => {
  await page.goto('/jobs'); await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByAltText(/DigitalBurj Logistics OS/)).toBeVisible(); await shot(page, '01-login');
});
test('owner overview shows live KPIs from the API', async ({ page }) => {
  await login(page, 'layla'); await expect(page.getByRole('heading', { name: 'Owner overview' })).toBeVisible();
  await expect(page.getByText('What is moving?')).toBeVisible(); await expect(page.getByText('Jobs by status')).toBeVisible(); await expect(page.getByText(/Unbilled work/)).toBeVisible();
  await page.waitForTimeout(1200); await shot(page, '02-today');
});
test('job workspace: tabs, tracking separates estimated from actual, four margins', async ({ page }) => {
  await login(page, 'layla'); await page.goto('/jobs'); await expect(page.getByRole('link', { name: /^JOB-/ }).first()).toBeVisible(); await shot(page, '03-jobs');
  await page.getByRole('link', { name: /^JOB-/ }).first().click(); await expect(page.getByRole('tab', { name: 'Costs & Revenue' })).toBeVisible();
  await page.getByRole('tab', { name: 'tracking' }).click(); await expect(page.getByTestId('source-badge').first()).toBeVisible();
  await expect(page.getByTestId('source-badge').filter({ hasText: /^estimated/ })).toHaveCount(1); await expect(page.getByTestId('source-badge').filter({ hasText: /^carrier/ })).toHaveCount(1); await shot(page, '04-tracking');
  await page.getByRole('tab', { name: 'Costs & Revenue' }).click(); await expect(page.getByText('Accounting (posted)')).toBeVisible(); await expect(page.getByText('Cash collected')).toBeVisible(); await shot(page, '05-margin');
  await page.getByRole('tab', { name: 'audit' }).click(); await expect(page.getByTestId('not-in-release')).toBeVisible();
});
test('quote builder: live totals use server rounding rules (tax half-up per line)', async ({ page }) => {
  await login(page, 'omar'); await page.goto('/quotes/new');
  await page.getByLabel('Description').fill('Terminal handling'); await page.getByLabel('Unit price').fill('1500.50');
  await expect(page.getByText('AED 1,500.50').first()).toBeVisible(); await expect(page.getByText('AED 75.03')).toBeVisible();          // 5% of 1500.50 = 75.025 → 75.03
  await page.getByRole('button', { name: 'Save draft' }).click(); await expect(page.getByText('Select an entity')).toBeVisible(); await shot(page, '06-quote-builder');
});
test('warehouse: maker-checker is enforced and the API error is shown, not swallowed', async ({ page }) => {
  await login(page, 'layla'); await page.goto('/warehouse'); await expect(page.getByText('Insulin pens 2–8 °C')).toBeVisible(); await shot(page, '07-warehouse');
  await page.getByRole('row', { name: /Canned goods/ }).getByRole('button', { name: 'Request release' }).click();     // bonded stock, owner requests…
  await expect(page.getByLabel('Release order to authorise (second person)')).toHaveValue(/^[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Authorise & release' }).click();                                              // …and tries to authorise own request
  await expect(page.getByRole('alert').filter({ hasText: 'SEPARATION_OF_DUTIES' })).toBeVisible(); await shot(page, '08-separation-of-duties');
});
test('permission-denied state: sales has no approvals access', async ({ page }) => {
  await login(page, 'omar'); await page.goto('/approvals'); await expect(page.getByTestId('forbidden')).toBeVisible();
});
test('browser JS never sees the access token; mutations without CSRF are refused by the gateway', async ({ page, request }) => {
  await login(page, 'layla'); const cookies = await page.context().cookies(); const s = cookies.find((c) => c.name === 'dbl_session')!; expect(s.httpOnly).toBe(true);
  expect(await page.evaluate(() => document.cookie)).not.toContain('dbl_session');
  const me = await page.evaluate(() => fetch('/api/auth/me').then((r) => r.text())); expect(me).not.toMatch(/eyJ/);
  const r = await page.evaluate(() => fetch('/api/proxy/api/v1/parties', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ legalName: 'x', roles: ['customer'] }) }).then((x) => x.status)); expect(r).toBe(403);
  void request;
});
