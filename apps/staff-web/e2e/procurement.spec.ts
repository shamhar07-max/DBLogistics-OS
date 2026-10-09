import { expect, test, type Page } from '@playwright/test';
const tenant = process.env.TENANT_ID!;
async function login(page: Page, subject: string) {
  await page.goto('/login');
  await page.waitForFunction(() => { const el=document.querySelector('main');return !!el && Object.keys(el).some(k=>k.startsWith('__reactProps')); });
  await page.getByPlaceholder('OIDC subject').fill(subject);await page.getByPlaceholder('Tenant id (uuid)').fill(tenant);
  await page.getByRole('button',{name:'Dev sign in'}).click();await page.waitForURL('/');
}
test('pricing prepares and compares a rate request; an independent owner publishes the award', async ({page}) => {
  test.setTimeout(180000);
  await login(page,'nadia');await page.goto('/enquiries');await page.getByRole('link',{name:'Rate procurement'}).click();
  await expect(page.getByRole('heading',{name:'Rate procurement',exact:true})).toBeVisible();
  await page.getByLabel('Legal entity').selectOption({index:1});await page.getByLabel('Origin',{exact:true}).fill('Shanghai');await page.getByLabel('Destination',{exact:true}).fill('Jebel Ali');
  const requirements=`Procurement acceptance ${Date.now()}: 22 pallets with destination handling`;
  await page.getByLabel('Cargo, inclusions and required service').fill(requirements);
  await page.getByLabel('Response deadline (your local time)').fill(new Date(Date.now()+86400000).toISOString().slice(0,16));
  await page.getByLabel('Invited suppliers (select one or more)').selectOption({label:'Ocean Line One'});
  await page.getByRole('button',{name:'Prepare request'}).click();await expect(page.getByText(requirements,{exact:true})).toBeVisible();
  const ref=await page.getByRole('button',{name:/^RFQ-/,pressed:true}).innerText();
  await page.getByRole('button',{name:'Issue for manual distribution'}).click();
  await page.getByLabel('Invited supplier',{exact:true}).selectOption({label:'Ocean Line One'});
  await page.getByLabel('Freight (AED)').fill('1000.0001');await page.getByLabel('Local charges (AED)').fill('100.0002');await page.getByLabel('Transit days',{exact:true}).fill('20');await page.getByLabel('Free days',{exact:true}).fill('14');
  await page.getByLabel('Valid until',{exact:true}).fill(new Date(Date.now()+10*86400000).toISOString().slice(0,10));await page.getByLabel('Inclusions, exclusions and terms').fill('Includes terminal handling; excludes customs duty.');
  await page.getByRole('button',{name:'Record response'}).click();await expect(page.getByText('1100.0003 AED',{exact:true}).first()).toBeVisible();
  await page.getByLabel('Valid latest response').selectOption({index:1});await expect(page.getByRole('button',{name:'Award and publish rate'})).toBeDisabled();
  await page.goto('/api/auth/logout');await login(page,'layla');await page.goto('/procurement');await page.getByRole('button',{name:ref,exact:true}).click();
  await page.getByLabel('Valid latest response').selectOption({index:1});await page.getByLabel('Award justification').fill('Suitable transit and free days at the best reviewed landed rate');
  await page.getByRole('button',{name:'Award and publish rate'}).click();await expect(page.getByText(/Approved rate created/)).toBeVisible();
  await expect(page.getByRole('heading',{name:'Response history'})).toBeVisible();
});
