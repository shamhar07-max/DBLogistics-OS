import { execSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
const TENANT = process.env.TENANT_ID!;
/** Next dev serves HTML before React hydrates; interacting earlier loses typed values and replays clicks mid-hydration. Wait until the page is interactive. */
const go = async (page: Page, path: string) => { await page.goto(path); await page.waitForFunction(() => { const el = document.querySelector('main'); return !!el && Object.keys(el).some((k) => k.startsWith('__reactProps')); }, null, { timeout: 30000 }); };
const shot = (p: Page, n: string) => p.screenshot({ path: `e2e/artifacts/${n}.png`, fullPage: true });
async function login(page: Page, subject: string) { await go(page, '/login'); await page.getByPlaceholder('OIDC subject').fill(subject); await page.getByPlaceholder('Tenant id (uuid)').fill(TENANT); await page.getByRole('button', { name: 'Dev sign in' }).click(); await page.waitForURL('/'); }
const sql = (q: string) => execSync(`psql -h /tmp -p 54329 -U postgres -d dbl -tAc "${q.replace(/"/g, '\\"')}"`).toString().trim();
const uniq = () => Math.random().toString(36).slice(2, 8);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const rowsOf = (page: Page) => page.getByRole('row').filter({ has: page.getByRole('link') });

test('unauthenticated users are sent to login; the master logo is shown', async ({ page }) => {
  await go(page, '/shipments'); await expect(page).toHaveURL(/\/login$/); await expect(page.getByAltText(/DigitalBurj Logistics OS/)).toBeVisible(); await shot(page, '01-login');
});
test('customer overview: own KPIs, quotes waiting, company name in the header; navigation is the customer set', async ({ page }) => {
  await login(page, 'pharma-user'); await expect(page.getByRole('heading', { level: 1, name: 'Your shipments' })).toBeVisible();
  await expect(page.getByTestId('who')).toHaveText('Gulf Pharma Distribution'); await expect(page.getByText('Waiting for your acceptance')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link')).toHaveText(['Overview', 'Shipments', 'Quotes', 'Invoices', 'Documents', 'Account']); await page.waitForTimeout(900); await shot(page, '02-customer-overview');
});
test('isolation: each customer sees only their own shipments, invoices and quotes', async ({ page }) => {
  await login(page, 'pharma-user'); await go(page, '/shipments'); await expect(rowsOf(page)).toHaveCount(2); await go(page, '/invoices'); await expect(page.getByText('No invoices yet.')).toBeVisible();
  await page.context().clearCookies(); await login(page, 'foods-user'); await go(page, '/shipments'); await expect(rowsOf(page)).toHaveCount(1); await go(page, '/invoices'); await expect(rowsOf(page)).toHaveCount(1); await shot(page, '03-customer-invoices');
  await page.getByRole('link', { name: /^INV-/ }).click(); await expect(page.getByText('Tax invoice')).toBeVisible(); await expect(page.getByText(/Total/).first()).toBeVisible(); await shot(page, '04-invoice-detail');
  await go(page, '/quotes'); await expect(rowsOf(page)).toHaveCount(1); await expect(page.getByText('awaiting your acceptance')).toHaveCount(0);     // their accepted quote only — never the other customer’s open quotation
});
test('shipment detail: tracking separates estimates from actuals; route and cargo; a customer cannot report milestones', async ({ page }) => {
  await login(page, 'pharma-user'); await go(page, '/shipments'); await rowsOf(page).first().getByRole('link').click();
  await expect(page.getByTestId('source-badge').filter({ hasText: /^estimated/ })).toHaveCount(1); await expect(page.getByTestId('source-badge').filter({ hasText: /^carrier/ })).toHaveCount(1); await expect(page.getByText('Report a milestone')).toHaveCount(0); await shot(page, '05-shipment-tracking');
  await page.getByRole('tab', { name: 'Route & cargo' }).click(); await expect(page.getByText('Palletised cargo')).toBeVisible(); await expect(page.getByRole('tab', { name: 'Invoices' })).toBeVisible();
});
test('customer accepts a quotation in the portal; acceptance is recorded and the button disappears', async ({ page }) => {
  await login(page, 'pharma-user'); await go(page, '/quotes'); await page.getByRole('link', { name: /^Q-|QUO-|^QT-/ }).first().click(); await expect(page.getByRole('heading', { name: 'Accept this quotation' })).toBeVisible(); await shot(page, '06-quote-detail');
  const btn = page.getByRole('button', { name: 'Accept quotation' }); await expect(btn).toBeDisabled(); await page.getByLabel('Your full name').fill('Dana Ops'); await page.getByRole('checkbox').check(); await btn.click();
  await expect(page.getByText('Accepted — thank you')).toBeVisible();
});
test('customer requests a quote; it appears under My requests', async ({ page }) => {
  await login(page, 'foods-user'); await go(page, '/quotes/new'); const commodity = `Canned fish ${uniq()}`;
  await page.getByLabel('From (city / port)').fill('Mumbai'); await page.getByLabel('To (city / port)').fill('Jebel Ali'); await page.getByLabel('Commodity').fill(commodity); await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByText(/Request ENQ-.* received/)).toBeVisible(); await shot(page, '07-request-sent'); await go(page, '/quotes'); await page.getByRole('tab', { name: 'My requests' }).click(); await expect(page.getByRole('row').filter({ hasText: 'Mumbai → Jebel Ali' })).toBeVisible();
});
test('documents: upload to own shipment, scan, then preview and download through a signed link', async ({ page }) => {
  await login(page, 'foods-user'); await go(page, '/shipments'); await rowsOf(page).first().getByRole('link').click(); await page.getByRole('tab', { name: 'Documents' }).click();
  const ref = `PL-${uniq()}`; await page.getByLabel('File').setInputFiles({ name: 'packing.png', mimeType: 'image/png', buffer: PNG }); await page.getByLabel('Reference (optional)').fill(ref); await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(page.getByText(/Uploaded — it will be available after the security scan/)).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: ref }); await expect(row).toBeVisible(); await expect(row.getByText('being scanned')).toBeVisible(); await expect(row.getByRole('button', { name: 'Preview' })).toBeDisabled();       // unscanned files cannot be opened
  sql(`update platform.document_versions set scan_status='clean' where tenant_id='${TENANT}' and document_id in (select id from platform.documents where external_reference='${ref}')`);
  await page.reload(); await page.getByRole('tab', { name: 'Documents' }).click(); const row2 = page.getByRole('row').filter({ hasText: ref }); await row2.getByRole('button', { name: 'Preview' }).click();
  const img = page.getByRole('dialog').getByRole('img'); await expect(img).toBeVisible(); await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1); await shot(page, '08-document-preview');
  expect(sql(`select issuer_kind from platform.documents where external_reference='${ref}'`)).toBe('customer');
});
test('agent: sees only shipments they operate, reports a milestone as supplier-sourced, has no money or quote screens', async ({ page }) => {
  await login(page, 'agent-user'); await expect(page.getByTestId('who')).toHaveText('Rhein-Main Air Agents'); await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link')).toHaveText(['Overview', 'Shipments', 'Documents', 'Account']);
  await go(page, '/shipments'); await expect(rowsOf(page)).toHaveCount(1); await rowsOf(page).first().getByRole('link').click(); await expect(page.getByText('Report a milestone')).toBeVisible();
  await page.getByLabel('Milestone').selectOption('ARRIVED'); await page.getByRole('button', { name: 'Report', exact: true }).click(); await expect(page.getByRole('listitem').filter({ hasText: 'ARRIVED' })).toBeVisible(); await expect(page.getByRole('listitem').filter({ hasText: 'ARRIVED' }).getByTestId('source-badge')).toContainText('supplier'); await shot(page, '09-agent-shipment');
  await go(page, '/invoices'); await expect(page.getByTestId('forbidden')).toBeVisible();
});
test('transporter: sees only its dispatched trip, captures proof of delivery per stop, trip completes', async ({ page }) => {
  await login(page, 'haulier-user'); await expect(page.getByRole('heading', { level: 1, name: 'Your trips' })).toBeVisible(); await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link')).toHaveText(['Trips', 'Documents', 'Account']);
  await expect(page.getByTestId('stop')).toHaveCount(2); await shot(page, '10-transporter-trip');
  await page.getByLabel('Received by, stop 1').fill('Gate officer'); await page.getByRole('button', { name: /Confirm pickup/ }).click(); await expect(page.getByTestId('stop').first().getByText(/signed by Gate officer/)).toBeVisible();
  await page.getByLabel('Received by, stop 2').fill('Warehouse manager'); await page.getByRole('button', { name: /Capture proof of delivery/ }).click(); await expect(page.getByTestId('stop').nth(1).getByText(/signed by Warehouse manager/)).toBeVisible();
  await expect(page.getByText('completed').first()).toBeVisible(); await shot(page, '11-trip-completed'); await go(page, '/shipments'); await expect(rowsOf(page)).toHaveCount(1); await go(page, '/quotes'); await expect(page.getByTestId('forbidden')).toBeVisible();
});
test('account page shows company and plain-language permissions', async ({ page }) => {
  await login(page, 'foods-user'); await go(page, '/account'); await expect(page.getByTestId('account-company')).toHaveText('Al Noor Foods Trading'); await expect(page.getByText('✓ Accept quotations')).toBeVisible();
});
test.describe('phone layout', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('no screen scrolls sideways on a phone', async ({ page }) => {
    test.setTimeout(180_000);
    await login(page, 'foods-user');
    for (const path of ['/', '/shipments', '/quotes', '/quotes/new', '/invoices', '/documents', '/account']) {
      await go(page, path); await expect(page.getByRole('heading', { level: 1 })).toBeVisible(); await page.waitForTimeout(250);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), path).toBeLessThanOrEqual(1);
    }
    await shot(page, '12-phone');
  });
});
