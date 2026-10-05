import catalogue from './catalogue.json';
import { esc } from './security';
import { ROLES, modulesFor, can, scopeOf, type Module } from './roles';
import type { Session } from './types';

export interface Sector { no: number; name: string; firstService: string; buyer: string; workflow: string; alignment: string; types: { name: string; directory: boolean }[]; requirements: string }
export const SECTORS = catalogue as Sector[];
export const LIVE_SECTOR = 1;
const IMG: Record<string, string> = { 'Logistics & Freight': '01-logistics', 'Travel & Tourism': '02-travel', 'Trading & Distribution': '03-trading', 'Real Estate': '04-real-estate', 'Construction & Contracting': '05-construction', 'Facility Management': '06-facility', 'Professional Services': '07-services', Recruitment: '08-recruitment', Retail: '09-retail', Automotive: '10-automotive', Hospitality: '11-hospitality', Education: '12-education', Manufacturing: '13-manufacturing', 'Healthcare Administration': '14-healthcare', 'E-commerce': '15-ecommerce' };
const img = (s: Sector) => `/industry/${IMG[s.alignment]}.webp`;

const CSS = `:root{--bg:#F6F5F1;--ink:#0F1714;--accent:#F23A1D;--accent2:#FF7A45;--tint:#F5DBD3;--muted:#5C6661;--line:#E4E1D8;--card:#fff;--ok:#127A4B;--r:14px}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 'Instrument Sans',system-ui,sans-serif}
h1,h2,h3,h4{font-family:'Plus Jakarta Sans',Arial,sans-serif;line-height:1.15;margin:0;letter-spacing:-.02em}a{color:var(--accent)}img{max-width:100%}
.wrap{max-width:1240px;margin:0 auto;padding:0 20px}.logo{display:block;height:36px;width:auto}
header.top{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 0}header.top nav{display:flex;gap:18px;align-items:center;font-size:14px}header.top nav a{color:var(--ink);text-decoration:none;font-weight:600}header.top nav a.btn{color:#fff}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:0;border-radius:var(--r);padding:12px 20px;font:600 15px 'Plus Jakarta Sans',Arial,sans-serif;cursor:pointer;text-decoration:none;background:var(--ink);color:#fff}
.btn.accent{background:var(--accent);box-shadow:0 10px 24px -10px rgba(242,58,29,.8)}.btn.ghost{background:transparent;color:var(--ink);box-shadow:inset 0 0 0 1.5px var(--ink)}.btn.sm{padding:8px 14px;font-size:13px}.btn:focus-visible,input:focus-visible,select:focus-visible,a:focus-visible,button:focus-visible{outline:3px solid var(--accent2);outline-offset:2px}.btn[disabled]{opacity:.55;cursor:wait}
.eyebrow{font:700 12px 'Plus Jakarta Sans',Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}
.hero{padding:34px 0 26px}.hero h1{font-size:clamp(34px,5.4vw,64px);max-width:20ch;margin:10px 0 14px}.hero p{max-width:60ch;color:var(--muted);font-size:18px;margin:0}
.stats{display:flex;gap:34px;flex-wrap:wrap;margin:26px 0 8px}.stats b{display:block;font:800 40px 'Plus Jakarta Sans',Arial,sans-serif;color:var(--accent)}.stats span{font-size:14px;color:var(--muted)}
.tools{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin:22px 0 18px}.tools input{flex:1;min-width:220px}
input,select{width:100%;border:1.5px solid var(--line);background:#fff;border-radius:12px;padding:12px 14px;font:inherit;color:var(--ink)}input:focus,select:focus{border-color:var(--ink)}
label{display:grid;gap:6px;font-size:13px;font-weight:600}label small{font-weight:400;color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:16px;padding-bottom:50px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);overflow:hidden;display:flex;flex-direction:column;transition:transform .15s,box-shadow .15s}.card:hover{transform:translateY(-3px);box-shadow:0 18px 40px -22px rgba(15,23,20,.45)}
.card .ph{height:120px;background:var(--tint) center/cover no-repeat;position:relative}.card .no{position:absolute;left:12px;top:10px;background:rgba(255,255,255,.92);border-radius:999px;padding:2px 10px;font:700 12px 'Plus Jakarta Sans',Arial,sans-serif}
.card .bd{padding:16px;display:flex;flex-direction:column;gap:8px;flex:1}.card h3{font-size:19px}.card p{margin:0;font-size:14px;color:var(--muted)}.card .meta{font-size:12px;color:var(--muted);margin-top:auto;padding-top:8px}
.badge{display:inline-block;border-radius:999px;padding:3px 10px;font:700 11px 'Plus Jakarta Sans',Arial,sans-serif;letter-spacing:.04em;text-transform:uppercase;background:var(--tint);color:#8a2412}.badge.live{background:#DDF3E8;color:var(--ok)}
.card.live{grid-column:1/-1;flex-direction:row;border:2px solid var(--ink)}.card.live .ph{width:38%;height:auto;min-height:240px;flex:none}.card.live h3{font-size:30px}.card.live .bd{padding:26px;gap:12px}.card.live p{font-size:16px}
@media(max-width:720px){.card.live{flex-direction:column}.card.live .ph{width:100%;min-height:150px}header.top nav .hide-m{display:none}}
dialog{border:0;border-radius:18px;padding:0;max-width:760px;width:calc(100% - 24px);box-shadow:0 30px 80px rgba(0,0,0,.35)}dialog::backdrop{background:rgba(15,23,20,.55)}dialog .in{padding:26px;max-height:82vh;overflow:auto}
dialog h3{font-size:26px;margin:6px 0 10px}dialog dl{display:grid;grid-template-columns:140px 1fr;gap:6px 14px;font-size:14px}dialog dt{color:var(--muted)}ul.types{columns:2;gap:24px;padding-left:18px;font-size:14px}ul.types li{break-inside:avoid;margin-bottom:3px}@media(max-width:600px){ul.types{columns:1}dialog dl{grid-template-columns:1fr}}
footer.f{border-top:1px solid var(--line);padding:26px 0 40px;color:var(--muted);font-size:13px}
.auth{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);min-height:100vh}.auth .side{background:var(--ink);color:#fff;padding:36px;display:flex;flex-direction:column;gap:20px;background-image:linear-gradient(180deg,rgba(15,23,20,.88),rgba(15,23,20,.96)),var(--bgimg);background-size:cover}
.auth .side .pl{background:#fff;border-radius:12px;padding:10px 14px;display:inline-block;align-self:flex-start}.auth .side h2{font-size:34px}.auth .side li{margin:8px 0;color:#d9ded9}.auth .main{padding:30px 26px 60px;overflow:auto}
.tabs{display:flex;gap:6px;background:#ebe9e2;border-radius:14px;padding:5px;max-width:360px;margin-bottom:22px}.tabs button{flex:1;border:0;background:transparent;border-radius:10px;padding:10px;font:700 14px 'Plus Jakarta Sans',Arial,sans-serif;cursor:pointer;color:var(--muted)}.tabs button[aria-selected=true]{background:#fff;color:var(--ink);box-shadow:0 2px 8px rgba(0,0,0,.08)}
form.f{max-width:720px;display:grid;gap:16px}fieldset{border:1px solid var(--line);border-radius:var(--r);padding:16px 16px 18px;margin:0;display:grid;gap:14px;background:#fff}legend{font:800 14px 'Plus Jakarta Sans',Arial,sans-serif;padding:0 8px}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:14px}.row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}@media(max-width:700px){.auth{grid-template-columns:1fr}.auth .side{padding:22px}.row2,.row3{grid-template-columns:1fr}}
.err{color:#B3261E;font-size:13px;min-height:0}.note{border-radius:12px;padding:12px 14px;font-size:14px;background:var(--tint);color:#5b1b0e}.note.ok{background:#DDF3E8;color:#0b4a2d}.note.err{background:#fde7e5;color:#8f1d16}
.meter{height:6px;border-radius:6px;background:#e8e5dc;overflow:hidden}.meter i{display:block;height:100%;width:0;background:var(--accent);transition:width .2s}
.app{display:grid;grid-template-columns:260px 1fr;min-height:100vh}.app aside{background:#fff;border-right:1px solid var(--line);padding:18px 14px;display:flex;flex-direction:column;gap:6px;position:sticky;top:0;height:100vh;overflow:auto}
.app aside a.nav{display:flex;justify-content:space-between;gap:8px;align-items:center;padding:10px 12px;border-radius:12px;color:var(--ink);text-decoration:none;font-weight:600;font-size:14px}.app aside a.nav:hover{background:var(--bg)}.app aside a.nav[aria-current=page]{background:var(--ink);color:#fff}
.app main{padding:24px 28px 60px;min-width:0}.app .bar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:22px;flex-wrap:wrap}
.panel{background:#fff;border:1px solid var(--line);border-radius:var(--r);padding:20px;margin-bottom:18px}.panel h3{font-size:18px;margin-bottom:12px}
.mods{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}.mod{background:#fff;border:1px solid var(--line);border-radius:var(--r);padding:16px;text-decoration:none;color:var(--ink);display:block}.mod:hover{border-color:var(--ink)}.mod h4{font-size:17px;margin-bottom:6px}.mod p{margin:0;color:var(--muted);font-size:14px}
table{width:100%;border-collapse:collapse;font-size:14px}th{text-align:left;font:700 12px 'Plus Jakarta Sans',Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:8px;border-bottom:1.5px solid var(--line)}td{padding:10px 8px;border-bottom:1px solid var(--line);vertical-align:middle}.tw{overflow-x:auto}
.chip{display:inline-block;padding:2px 9px;border-radius:999px;background:#eceae2;font-size:12px;font-weight:700}.steps{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.steps span{background:var(--tint);border-radius:999px;padding:4px 12px;font-size:13px;font-weight:600}.perms{display:flex;flex-wrap:wrap;gap:6px}.perms code{background:#f1efe8;border-radius:8px;padding:2px 8px;font-size:12px}
@media(max-width:860px){.app{grid-template-columns:1fr}.app aside{position:static;height:auto;flex-direction:row;flex-wrap:wrap;border-right:0;border-bottom:1px solid var(--line)}.app main{padding:18px 16px 50px}}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}`;

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap">`;
export const page = (title: string, body: string, desc = 'DigitalBurj Business OS and Industry Solutions for SMEs.') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><meta name="robots" content="index,follow"><link rel="icon" href="/brand/favicon.png"><meta property="og:image" content="/brand/opengraph.png"><meta name="theme-color" content="#F6F5F1">${FONTS}<style>${CSS}</style></head><body>${body}</body></html>`;
const LOGO = `<a href="/" aria-label="DigitalBurj Business"><img class="logo" src="/brand/wordmark-480.webp" alt="DigitalBurj" width="170" height="36"></a>`;

const card = (s: Sector) => {
  const live = s.no === LIVE_SECTOR;
  return `<article class="card${live ? ' live' : ''}" data-no="${s.no}" data-q="${esc((s.name + ' ' + s.firstService + ' ' + s.alignment + ' ' + s.types.map((t) => t.name).join(' ')).toLowerCase())}" data-al="${esc(s.alignment)}">
<div class="ph" style="background-image:url('${img(s)}')" role="img" aria-label="${esc(s.alignment)}"><span class="no">${String(s.no).padStart(2, '0')}</span></div>
<div class="bd"><div>${live ? '<span class="badge live">Live now</span>' : '<span class="badge">Coming soon</span>'}</div><h3>${esc(s.name)}</h3>
<p><b>Starts with:</b> ${esc(s.firstService)}</p>${live ? `<p>${esc(s.workflow)}.</p>` : ''}
<div class="meta">${s.types.length} customer types · ${esc(s.alignment)}</div>
<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">${live ? '<a class="btn accent" href="/logistics">Sign in / Register</a>' : ''}<button class="btn ${live ? 'ghost' : ''} sm" type="button" data-open="${s.no}">${live ? 'Who it is for' : 'View details'}</button></div></div></article>`;
};
export function landing() {
  const aligns = [...new Set(SECTORS.map((s) => s.alignment))];
  const ordered = [...SECTORS].sort((a, b) => (a.no === LIVE_SECTOR ? -1 : b.no === LIVE_SECTOR ? 1 : a.no - b.no));
  return page('DigitalBurj Business · Industry Solutions for SMEs', `<div class="wrap">
<header class="top">${LOGO}<nav><a class="hide-m" href="https://digitalburj.com/business-os">Business OS</a><a class="hide-m" href="https://digitalburj.com/industries">Industries</a><a class="hide-m" href="https://digitalburj.com/pricing">Pricing</a><a class="btn sm" href="/logistics">Sign in</a></nav></header>
<section class="hero"><div class="eyebrow">Business OS &amp; Industry Solutions</div><h1>Pick your industry. Run it on one core.</h1>
<p>Forty sectors, 746 customer types, one platform. Logistics &amp; Freight is live today — sign in or register your company to open your workspace. Every other sector is on the roadmap; tell us which one you need.</p>
<div class="stats"><div><b>40</b><span>Sector groups</span></div><div><b>746</b><span>Customer types</span></div><div><b>14</b><span>Business OS modules</span></div></div></section>
<div class="tools"><input id="q" type="search" placeholder="Search a sector or business type — e.g. “freight forwarder”, “clinic”, “bakery”" aria-label="Search sectors"><select id="al" aria-label="Filter by industry group" style="max-width:260px"><option value="">All industry groups</option>${aligns.map((a) => `<option>${esc(a)}</option>`).join('')}</select><span id="count" aria-live="polite" style="font-size:14px;color:var(--muted)"></span></div>
<section class="grid" id="grid" aria-label="Industry sectors">${ordered.map(card).join('')}</section>
<footer class="f"><div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px"><span>© DigitalBurj · Learn. Build. Transform.</span><span>Suggested entry services are planning recommendations; specialised workflows are scoped before delivery. <a href="https://digitalburj.com/contact">Contact us</a></span></div></footer></div>
<dialog id="dlg" aria-labelledby="dt"><div class="in" id="dbody"></div></dialog>
<script>
const $=s=>document.querySelector(s),cards=[...document.querySelectorAll('.card')];
function filt(){const q=$('#q').value.trim().toLowerCase(),a=$('#al').value;let n=0;for(const c of cards){const ok=(!q||c.dataset.q.includes(q))&&(!a||c.dataset.al===a);c.hidden=!ok;if(ok)n++}$('#count').textContent=n+' of ${SECTORS.length} sectors'}
$('#q').addEventListener('input',filt);$('#al').addEventListener('change',filt);filt();
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
document.addEventListener('click',async e=>{const b=e.target.closest('[data-open]');if(b){const r=await fetch('/api/sectors/'+b.dataset.open);const s=await r.json();
$('#dbody').innerHTML='<div class="eyebrow">Sector '+String(s.no).padStart(2,'0')+' · '+s.types.length+' customer types</div><h3 id="dt">'+esc(s.name)+'</h3><dl><dt>Suggested first service</dt><dd>'+esc(s.firstService)+'</dd><dt>Typical buyer</dt><dd>'+esc(s.buyer)+'</dd><dt>Typical workflow</dt><dd>'+esc(s.workflow)+'</dd><dt>Industry group</dt><dd>'+esc(s.alignment)+'</dd><dt>Delivery notes</dt><dd>'+esc(s.requirements)+'</dd></dl><h4 style="margin:18px 0 8px">Business and organisation types</h4><ul class="types">'+s.types.map(t=>'<li>'+esc(t.name)+(t.directory?' <span class="chip" title="Named in the website directory">★</span>':'')+'</li>').join('')+'</ul><div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:18px">'+(s.no===${LIVE_SECTOR}?'<a class="btn accent" href="/logistics">Sign in / Register</a>':'<a class="btn accent" href="https://digitalburj.com/get-started">Book a free process review</a>')+'<button class="btn ghost" type="button" id="cl">Close</button></div>';$('#dlg').showModal();$('#cl').onclick=()=>$('#dlg').close()}});
$('#dlg').addEventListener('click',e=>{if(e.target===$('#dlg'))$('#dlg').close()});
</script>`);
}

const field = (id: string, label: string, o: { type?: string; req?: boolean; ph?: string; auto?: string; hint?: string; max?: number } = {}) => `<label for="${id}">${label}${o.req ? ' *' : ''}<input id="${id}" name="${id}" type="${o.type ?? 'text'}"${o.req ? ' required' : ''}${o.ph ? ` placeholder="${esc(o.ph)}"` : ''}${o.auto ? ` autocomplete="${o.auto}"` : ''}${o.max ? ` maxlength="${o.max}"` : ''}>${o.hint ? `<small>${o.hint}</small>` : ''}<span class="err" data-err="${id}"></span></label>`;
const sel = (id: string, label: string, opts: string[], req = true, hint = '') => `<label for="${id}">${label}${req ? ' *' : ''}<select id="${id}" name="${id}"${req ? ' required' : ''}><option value="">Select…</option>${opts.map((o) => `<option>${esc(o)}</option>`).join('')}</select>${hint ? `<small>${hint}</small>` : ''}<span class="err" data-err="${id}"></span></label>`;
export const AUTHORITIES = ['Abu Dhabi DED', 'Dubai DET (Mainland)', 'Sharjah SEDD', 'Ajman DED', 'Umm Al Quwain DED', 'Ras Al Khaimah DED', 'Fujairah DED', 'Jebel Ali Free Zone (JAFZA)', 'Dubai Airport Freezone', 'Dubai South', 'Sharjah Airport International Free Zone', 'Other free zone', 'Outside the UAE'];
export const STAFF_SIZES = ['1–5', '6–20', '21–50', '51–100', '101–250', '250+'];
export const COUNTRIES = [['AE', 'United Arab Emirates'], ['SA', 'Saudi Arabia'], ['OM', 'Oman'], ['QA', 'Qatar'], ['KW', 'Kuwait'], ['BH', 'Bahrain'], ['IN', 'India'], ['PK', 'Pakistan'], ['GB', 'United Kingdom'], ['US', 'United States'], ['OTHER', 'Other']] as const;
export function authPage(tab: 'login' | 'register' = 'login', notice = '') {
  const s = SECTORS[0]!;
  return page('Logistics & Freight · Sign in or register — DigitalBurj Business', `<div class="auth">
<aside class="side" style="--bgimg:url('${img(s)}')"><span class="pl">${LOGO}</span><div><span class="badge live">Live now</span><h2 style="margin-top:10px">Logistics &amp; Freight</h2></div>
<p style="color:#d9ded9">${esc(s.workflow)}.</p><ul style="padding-left:18px"><li>Quotations with live totals and job profitability</li><li>Shipments, bookings, tracking — estimates kept apart from actuals</li><li>Customs, bonded warehouse custody and branded documents</li><li>Invoices, collections, WhatsApp &amp; email updates to customers</li><li>Role-based access: every person sees only what their role allows</li></ul>
<p style="margin-top:auto;font-size:13px;color:#aab3ad">For ${esc(s.types.slice(0, 6).map((t) => t.name.toLowerCase()).join(', '))} and more.</p></aside>
<main class="main"><p><a href="/">← All sectors</a></p><h1 style="font-size:32px;margin:6px 0 18px">Your Logistics workspace</h1>
${notice ? `<div class="note" role="status" style="max-width:720px;margin-bottom:14px">${esc(notice)}</div>` : ''}
<div class="tabs" role="tablist"><button role="tab" id="t-login" aria-selected="${tab === 'login'}" aria-controls="p-login">Sign in</button><button role="tab" id="t-register" aria-selected="${tab === 'register'}" aria-controls="p-register">Register company</button></div>
<section id="p-login" role="tabpanel" aria-labelledby="t-login" ${tab === 'login' ? '' : 'hidden'}><form class="f" id="login" novalidate style="max-width:440px">${field('l_email', 'Work email', { type: 'email', req: true, auto: 'username' })}${field('l_password', 'Password', { type: 'password', req: true, auto: 'current-password' })}
<div class="note err" id="l_msg" role="alert" hidden></div><button class="btn accent" type="submit">Sign in</button><p style="font-size:13px;color:var(--muted)">Forgot your password? Ask your company owner to reset it from <b>Team &amp; access</b>.</p></form></section>
<section id="p-register" role="tabpanel" aria-labelledby="t-register" ${tab === 'register' ? '' : 'hidden'}><form class="f" id="register" novalidate>
<fieldset><legend>1 · Company</legend><div class="row2">${field('legalName', 'Registered company name', { req: true, auto: 'organization', max: 160 })}${field('tradeName', 'Trading name', { max: 120, hint: 'If different' })}</div>
<div class="row2">${field('tradeLicense', 'Trade licence number', { req: true, max: 60 })}${sel('licenseAuthority', 'Licensing authority / free zone', AUTHORITIES)}</div>
<div class="row2">${field('trn', 'Tax registration number (TRN)', { max: 15, hint: '15 digits, if VAT-registered' })}${sel('businessType', 'Type of logistics business', s.types.map((t) => t.name))}</div>
<div class="row2">${sel('staffSize', 'Team size', STAFF_SIZES, false)}${field('website', 'Website', { type: 'url', ph: 'https://', max: 120 })}</div></fieldset>
<fieldset><legend>2 · Address &amp; contact</legend>${field('address', 'Registered address', { req: true, auto: 'street-address', max: 300 })}
<div class="row3"><label for="country">Country *<select id="country" name="country" required>${COUNTRIES.map(([c, n]) => `<option value="${c}"${c === 'AE' ? ' selected' : ''}>${n}</option>`).join('')}</select></label>${field('city', 'City / emirate', { req: true, auto: 'address-level2', max: 80 })}${field('phone', 'Company phone', { type: 'tel', req: true, ph: '+971…', auto: 'tel', max: 20 })}</div>
${field('companyEmail', 'General company email', { type: 'email', max: 120, hint: 'Optional — used on documents' })}</fieldset>
<fieldset><legend>3 · Primary administrator (Owner)</legend><div class="row2">${field('name', 'Full name', { req: true, auto: 'name', max: 120 })}${field('jobTitle', 'Job title', { max: 80 })}</div>
<div class="row2">${field('email', 'Work email (your sign-in)', { type: 'email', req: true, auto: 'email', max: 120 })}${field('mobile', 'Mobile', { type: 'tel', ph: '+971…', auto: 'tel', max: 20, req: true })}</div>
<div class="row2">${field('password', 'Password', { type: 'password', req: true, auto: 'new-password', max: 128, hint: 'At least 10 characters, with a number or symbol' })}${field('confirm', 'Confirm password', { type: 'password', req: true, auto: 'new-password', max: 128 })}</div><div class="meter" aria-hidden="true"><i id="meter"></i></div>
<label style="display:flex;gap:10px;align-items:flex-start;font-weight:500"><input type="checkbox" id="terms" style="width:auto;margin-top:4px"><span>I am authorised to register this company and agree to the <a href="https://digitalburj.com/contact" target="_blank" rel="noopener">terms of service and privacy notice</a>. *<span class="err" data-err="terms"></span></span></label></fieldset>
<div class="note err" id="r_msg" role="alert" hidden></div><button class="btn accent" type="submit">Create company &amp; open workspace</button><p style="font-size:13px;color:var(--muted)">You become the company <b>Owner</b>. You can then add your team and give each person a role.</p></form></section></main></div>
<script>
const $=s=>document.querySelector(s);
function tab(t){for(const k of ['login','register']){$('#p-'+k).hidden=k!==t;$('#t-'+k).setAttribute('aria-selected',k===t)}history.replaceState(null,'','#'+t)}
$('#t-login').onclick=()=>tab('login');$('#t-register').onclick=()=>tab('register');if(location.hash==='#register')tab('register');
$('#password').addEventListener('input',e=>{const v=e.target.value;let s=Math.min(4,(v.length>=10)+(v.length>=14)+(/[0-9]/.test(v)&&/[A-Za-z]/.test(v))+/[^A-Za-z0-9]/.test(v));$('#meter').style.width=s*25+'%'});
async function send(url,body,msg,btn){btn.disabled=true;msg.hidden=true;document.querySelectorAll('[data-err]').forEach(e=>e.textContent='');
try{const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));
if(r.ok){location.href=j.next||'/app';return}
if(j.fields)for(const [k,v] of Object.entries(j.fields)){const el=document.querySelector('[data-err="'+k+'"]');if(el)el.textContent=v}
msg.textContent=j.error||'Something went wrong. Please try again.';msg.hidden=false;msg.scrollIntoView({block:'nearest'})}catch{msg.textContent='Network problem — please try again.';msg.hidden=false}finally{btn.disabled=false}}
$('#login').addEventListener('submit',e=>{e.preventDefault();send('/api/login',{email:$('#l_email').value,password:$('#l_password').value},$('#l_msg'),e.submitter||e.target.querySelector('button[type=submit]'))});
$('#register').addEventListener('submit',e=>{e.preventDefault();const g=id=>($('#'+id).value||'').trim();
if($('#password').value!==$('#confirm').value){const m=document.querySelector('[data-err=confirm]');m.textContent='Passwords do not match.';return}
if(!$('#terms').checked){document.querySelector('[data-err=terms]').textContent=' Please confirm to continue.';return}
send('/api/register',{legalName:g('legalName'),tradeName:g('tradeName'),tradeLicense:g('tradeLicense'),licenseAuthority:g('licenseAuthority'),trn:g('trn'),businessType:g('businessType'),staffSize:g('staffSize'),website:g('website'),address:g('address'),country:g('country'),city:g('city'),phone:g('phone'),companyEmail:g('companyEmail'),name:g('name'),jobTitle:g('jobTitle'),email:g('email'),mobile:g('mobile'),password:$('#password').value,terms:true},$('#r_msg'),e.submitter||e.target.querySelector('button[type=submit]'))});
</script>`);
}

// ---------------- dashboard ----------------
export const roleName = (r: string) => ROLES[r]?.name ?? r;
function shell(s: Session, current: string, content: string, env: { os?: string }) {
  const mods = modulesFor(s.role);
  const nav = (href: string, label: string, key: string, tag = '') => `<a class="nav" href="${href}"${current === key ? ' aria-current="page"' : ''}><span>${esc(label)}</span>${tag}</a>`;
  return page(`${current === 'home' ? 'Dashboard' : current} · ${s.company}`, `<div class="app"><aside aria-label="Navigation"><div style="padding:6px 8px 14px">${LOGO}</div>
${nav('/app', 'Overview', 'home')}${mods.length ? '<div class="eyebrow" style="padding:12px 12px 4px">Workspace</div>' : ''}${mods.map((m) => nav(`/app/m/${m.key}`, m.title, m.key)).join('')}
<div class="eyebrow" style="padding:12px 12px 4px">Company</div>${nav('/app/company', 'Company profile', 'company')}${can(s.role, 'admin.tenant') ? nav('/app/team', 'Team & access', 'team') : ''}${can(s.role, 'audit.view') || can(s.role, 'admin.tenant') ? nav('/app/audit', 'Audit log', 'audit') : ''}${nav('/app/account', 'My account', 'account')}
<form method="post" action="/api/logout" style="margin-top:auto"><button class="btn ghost sm" style="width:100%">Sign out</button></form></aside>
<main><div class="bar"><div><div class="eyebrow">${esc(s.company)}</div></div><div style="font-size:14px"><b>${esc(s.name)}</b> <span class="chip">${esc(roleName(s.role))}</span></div></div>${content}</main></div>`);
}
const launch = (env: { os?: string; portal?: string }, role: string) => { const u = role && (role === 'customer_portal' || role === 'agent_portal' || role === 'transporter_portal' || role === 'driver') ? env.portal : env.os; return u ? `<a class="btn accent" href="${esc(u)}" target="_blank" rel="noopener">Open in Logistics OS</a>` : `<span class="note">The operational screens open from the Logistics OS application once it is connected to this company. Your access below is already enforced.</span>`; };
export function dashboard(s: Session, env: { os?: string; portal?: string }) {
  const mods = modulesFor(s.role); const r = ROLES[s.role]!;
  return shell(s, 'home', `<h1 style="font-size:30px;margin-bottom:6px">Welcome, ${esc(s.name.split(' ')[0])}</h1><p style="color:var(--muted);margin:0 0 20px">You are signed in as <b>${esc(r.name)}</b>. Only the areas your role allows are shown.</p>
<div class="panel"><h3>Your workspace</h3>${mods.length ? `<div class="mods">${mods.map((m) => `<a class="mod" href="/app/m/${m.key}"><h4>${esc(m.title)}</h4><p>${esc(m.blurb)}</p></a>`).join('')}</div>` : '<p>Your role has no workspace modules. Ask your company owner to review your access.</p>'}</div>
<div class="panel"><h3>Your access</h3><p style="margin-top:0;color:var(--muted)">${r.permissions.length} permissions from the <b>${esc(r.name)}</b> role.</p><div class="perms">${r.permissions.map((p) => `<code>${esc(p)}</code>`).join('')}</div></div>`, env);
}
export function modulePage(s: Session, m: Module, env: { os?: string; portal?: string }) {
  const mine = scopeOf(s.role, m);
  return shell(s, m.key, `<p><a href="/app">← Overview</a></p><h1 style="font-size:30px;margin:4px 0 8px">${esc(m.title)}</h1><p style="color:var(--muted);max-width:70ch">${esc(m.blurb)}</p><div class="steps" aria-label="Workflow">${m.steps.map((x, i) => `<span>${i + 1} · ${esc(x)}</span>`).join('')}</div>
<div class="panel"><h3>What your role can do here</h3><div class="perms">${mine.map((p) => `<code>${esc(p)}</code>`).join('')}</div></div><div class="panel"><h3>Open the operational screens</h3>${launch(env, s.role)}</div>`, env);
}
export const forbidden = (s: Session, env: { os?: string }) => shell(s, '', `<div class="panel" role="alert"><h1 style="font-size:26px;margin-bottom:8px">Not available for your role</h1><p>Your <b>${esc(roleName(s.role))}</b> role does not include this area. If you need it, ask your company owner.</p><a class="btn" href="/app">Back to overview</a></div>`, env);
export const notFound = () => page('Not found', `<div class="wrap" style="padding:80px 0"><h1>Page not found</h1><p><a href="/">DigitalBurj Business home</a></p></div>`);

export function companyPage(s: Session, t: Record<string, any>, env: {}) {
  const edit = can(s.role, 'admin.tenant'); const f = (id: string, label: string, v: unknown, type = 'text') => `<label for="${id}">${label}<input id="${id}" name="${id}" type="${type}" value="${esc(v)}"${edit ? '' : ' disabled'}></label>`;
  return shell(s, 'company', `<h1 style="font-size:28px;margin-bottom:16px">Company profile</h1><div class="panel"><form id="cf" class="f" novalidate><div class="row2">${f('legalName', 'Registered name', t.legal_name)}${f('tradeName', 'Trading name', t.trade_name)}</div><div class="row2">${f('tradeLicense', 'Trade licence', t.trade_license)}${f('trn', 'TRN', t.trn)}</div>
<div class="row2">${f('address', 'Address', t.address)}${f('city', 'City', t.city)}</div><div class="row3">${f('phone', 'Phone', t.phone, 'tel')}${f('companyEmail', 'Company email', t.email, 'email')}${f('website', 'Website', t.website, 'url')}</div>
<p style="font-size:13px;color:var(--muted)">${esc(t.business_type)} · ${esc(t.license_authority)} · ${esc(t.country)} · registered ${esc(String(t.created_at).slice(0, 10))}</p><div id="cm" class="note" hidden></div>${edit ? '<div><button class="btn accent" type="submit">Save company profile</button></div>' : '<p class="note">Only the company owner can edit these details.</p>'}</form></div>
<script>document.getElementById('cf').addEventListener('submit',async e=>{e.preventDefault();const b={};for(const el of e.target.elements)if(el.name)b[el.name]=el.value.trim();const r=await fetch('/api/company',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});const j=await r.json().catch(()=>({}));const m=document.getElementById('cm');m.hidden=false;m.className='note '+(r.ok?'ok':'err');m.textContent=r.ok?'Saved.':(j.error||'Could not save.')})</script>`, env);
}
export function teamPage(s: Session, members: any[], roles: string[], env: {}) {
  return shell(s, 'team', `<h1 style="font-size:28px;margin-bottom:16px">Team &amp; access</h1><div class="panel"><h3>Members</h3><div class="tw"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>${members.map((m) => `<tr><td><b>${esc(m.name)}</b><br><small style="color:var(--muted)">${esc(m.job_title ?? '')}</small></td><td>${esc(m.email)}</td><td>${m.id === s.userId || m.role === 'owner' ? `<span class="chip">${esc(roleName(m.role))}</span>` : `<select data-role="${m.id}" aria-label="Role for ${esc(m.name)}" style="padding:6px 8px">${roles.map((r) => `<option value="${r}"${r === m.role ? ' selected' : ''}>${esc(roleName(r))}</option>`).join('')}</select>`}</td><td>${esc(m.status)}${m.must_change ? ' · must change password' : ''}</td><td style="white-space:nowrap">${m.id === s.userId || m.role === 'owner' ? '' : `<button class="btn ghost sm" data-act="${m.status === 'active' ? 'disable' : 'enable'}" data-id="${m.id}">${m.status === 'active' ? 'Disable' : 'Enable'}</button> <button class="btn ghost sm" data-act="reset" data-id="${m.id}">Reset password</button>`}</td></tr>`).join('')}</tbody></table></div><div id="tm" class="note" hidden style="margin-top:12px"></div></div>
<div class="panel"><h3>Add a team member</h3><form id="af" class="f" novalidate><div class="row2"><label>Full name *<input name="name" required maxlength="120"></label><label>Work email *<input name="email" type="email" required maxlength="120"></label></div>
<div class="row2"><label>Role *<select name="role" required><option value="">Select…</option>${roles.map((r) => `<option value="${r}">${esc(roleName(r))}${EXT.has(r) ? ' — portal user' : ''}</option>`).join('')}</select></label><label>Job title<input name="jobTitle" maxlength="80"></label></div><p style="font-size:13px;color:var(--muted);margin:0">A one-time password is generated. Share it securely; the person must change it at first sign-in.</p><div><button class="btn accent" type="submit">Add member</button></div></form></div>
<script>
const tm=document.getElementById('tm');const show=(t,ok)=>{tm.hidden=false;tm.className='note '+(ok?'ok':'err');tm.textContent=t};
async function post(u,b,m='POST'){const r=await fetch(u,{method:m,headers:{'content-type':'application/json'},body:JSON.stringify(b)});return[r,await r.json().catch(()=>({}))]}
document.getElementById('af').addEventListener('submit',async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(e.target));const[r,j]=await post('/api/team/members',b);if(!r.ok)return show(j.error||'Could not add member.',false);show('Added '+b.email+'. One-time password (shown once): '+j.tempPassword,true);e.target.reset();setTimeout(()=>{},0)});
document.querySelectorAll('[data-role]').forEach(el=>el.addEventListener('change',async()=>{const[r,j]=await post('/api/team/members/'+el.dataset.role,{role:el.value},'PATCH');show(r.ok?'Role updated.':(j.error||'Could not update.'),r.ok)}));
document.querySelectorAll('[data-act]').forEach(el=>el.addEventListener('click',async()=>{const a=el.dataset.act;const[r,j]=await post('/api/team/members/'+el.dataset.id,{action:a},'PATCH');if(!r.ok)return show(j.error||'Failed.',false);if(a==='reset')show('New one-time password (shown once): '+j.tempPassword,true);else location.reload()}));
</script>`, env);
}
const EXT = new Set(['customer_portal', 'agent_portal', 'transporter_portal', 'driver']);
export function auditPage(s: Session, rows: any[], env: {}) {
  return shell(s, 'audit', `<h1 style="font-size:28px;margin-bottom:16px">Audit log</h1><div class="panel tw"><table><thead><tr><th>When (UTC)</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(String(r.at).replace('T', ' ').slice(0, 19))}</td><td>${esc(r.user_name ?? 'system')}</td><td><code>${esc(r.action)}</code></td><td>${esc(r.detail ?? '')}</td></tr>`).join('') || '<tr><td colspan="4">Nothing recorded yet.</td></tr>'}</tbody></table></div>`, env);
}
export function accountPage(s: Session, forced = false, env: {} = {}) {
  const body = `<h1 style="font-size:28px;margin-bottom:16px">${forced ? 'Choose a new password' : 'My account'}</h1>${forced ? '<div class="note" style="margin-bottom:14px">Your password was set by an administrator. Choose your own before continuing.</div>' : ''}<div class="panel"><p style="margin-top:0"><b>${esc(s.name)}</b> · ${esc(s.email)} · <span class="chip">${esc(roleName(s.role))}</span></p><h3>Change password</h3><form id="pf" class="f" novalidate style="max-width:420px"><label>Current password<input name="current" type="password" required autocomplete="current-password"></label><label>New password<input name="next" type="password" required autocomplete="new-password"><small>At least 10 characters, with a number or symbol</small></label><div id="pm" class="note" hidden></div><div><button class="btn accent" type="submit">Update password</button></div></form></div>
<script>document.getElementById('pf').addEventListener('submit',async e=>{e.preventDefault();const r=await fetch('/api/password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});const j=await r.json().catch(()=>({}));const m=document.getElementById('pm');m.hidden=false;m.className='note '+(r.ok?'ok':'err');m.textContent=r.ok?'Password updated.':(j.error||'Could not update.');if(r.ok&&${forced})location.href='/app'})</script>`;
  return forced ? page('Change password', `<div class="wrap" style="padding:30px 0">${LOGO}<div style="margin-top:24px;max-width:560px">${body}</div></div>`) : shell(s, 'account', body, env);
}
