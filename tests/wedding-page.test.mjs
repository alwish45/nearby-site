// The wedding website (wedding.html): what guests see and what it sends.
// Run from the repo root: node --test tests/
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PAGE = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), '../wedding.html')).href;
const HOST = 'vieoqoczhqbcxpflyjcp.supabase.co';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
let browser;
after(async () => { if (browser) await browser.close(); });

const E1 = { id: 'e1', kind: 'ceremony', name: 'Ceremony', event_date: '2027-06-12', start_time: '16:00', place: 'Red Butte Garden', address: '300 Wakara Way', asks_meal: false };
const E2 = { id: 'e2', kind: 'reception', name: 'Reception', event_date: '2027-06-12', start_time: '18:00', asks_meal: true };
const base = {
  locked: false, code: 'abc12345', name1: 'Alan', name2: 'Iryna', wedding_date: '2027-06-12', city: 'Salt Lake City', theme: 'sage',
  story: 'We met <script>window.__x=1</script> on a hike.', registry: [{ label: 'Zola', url: 'https://zola.com/a' }],
  meal_options: ['Chicken', 'Salmon'], rsvp_by: '2027-05-01', events: [E1, E2], household: null, messages: [], bad_invite: false,
};
const household = { name: 'The Lipps', guests: [
  { id: 'g1', first_name: 'Ann', last_name: 'Lipp', plus_one_allowed: false, rsvps: {} },
  { id: 'g2', first_name: 'Bob', last_name: 'Lipp', plus_one_allowed: true, rsvps: {} } ] };

async function open(query, handlers, tz = 'America/Denver') {
  browser ??= await chromium.launch();
  const ctx = await browser.newContext({ timezoneId: tz, viewport: { width: 390, height: 900 } });
  const page = await ctx.newPage();
  const calls = [], errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', d => d.accept());
  await page.clock.setFixedTime(new Date('2026-11-27T12:00:00-07:00'));
  await ctx.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.protocol === 'file:') return route.continue();
    if (u.hostname !== HOST) return route.abort();
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const fn = u.pathname.split('/').pop(); const body = JSON.parse(route.request().postData() || '{}');
    calls.push({ fn, body });
    const res = handlers[fn] ? handlers[fn](body) : { __status: 404 };
    if (res && res.__status) return route.fulfill({ status: res.__status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ message: res.message || 'nope' }) });
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(res ?? null) });
  });
  await page.goto(`${PAGE}?${query}`);
  await page.waitForSelector('#app h1');
  return { page, calls, errors, close: async () => { assert.deepEqual(errors, []); await ctx.close(); } };
}

test('public page: names, events, registry, story escaped, asks for the invite code; no sideways scroll', async () => {
  const t = await open('w=alan-and-iryna', { get_wedding_site: () => base });
  const text = await t.page.innerText('#app');
  assert.match(text, /Alan & Iryna/);
  assert.match(text, /Ceremony/);
  assert.match(text, /Red Butte Garden/);
  assert.match(text, /Zola/);
  assert.match(text, /Invite code/);
  assert.equal(await t.page.evaluate(() => window.__x), undefined);
  assert.match(text, /<script>/);
  assert.equal(await t.page.evaluate(() => document.body.dataset.theme), 'sage');
  assert.ok(await t.page.evaluate(() => document.documentElement.scrollWidth <= 390));
  assert.doesNotMatch(text, /Utah time/);
  await t.close();
});

test('an invite code shows the household; accepting asks the meal; Send RSVP sends their answers', async () => {
  let sent = null;
  const t = await open('w=abc12345&i=k7q2zp', {
    get_wedding_site: b => ({ ...base, household }),
    submit_wedding_rsvp: b => { sent = b; return { ...base, household: { ...household, guests: household.guests.map(g => ({ ...g, rsvps: { e2: { status: 'yes', meal: 'Salmon' } } })) } }; },
  }, 'America/New_York');
  assert.equal(t.calls[0].body.p_invite, 'K7Q2ZP');
  const text = await t.page.innerText('#app');
  assert.match(text, /Your invitation/);
  assert.match(text, /The Lipps/);
  assert.match(text, /Utah time/);
  await t.page.click('button[data-g="g1"][data-e="e2"][data-s="yes"]');
  await t.page.selectOption('select[data-meal-g="g1"][data-meal-e="e2"]', 'Salmon');
  await t.page.click('button[data-g="g2"][data-e="e1"][data-s="no"]');
  await t.page.fill('#d-g1', 'No nuts');
  await t.page.click('#send');
  await t.page.waitForSelector('.ok');
  assert.equal(sent.p_invite, 'K7Q2ZP');
  const a1 = sent.p_answers.find(a => a.guest_id === 'g1');
  assert.deepEqual([a1.event_id, a1.status, a1.meal, a1.dietary], ['e2', 'yes', 'Salmon', 'No nuts']);
  assert.ok(sent.p_answers.some(a => a.guest_id === 'g2' && a.status === 'no'));
  assert.match(await t.page.innerText('.ok'), /Thank you/);
  await t.close();
});

test('a private page asks for the password, then opens', async () => {
  const t = await open('w=abc12345', { get_wedding_site: b => (b.p_password === 'sunflower' ? base : { locked: true, name1: 'Alan', name2: 'Iryna', theme: 'blush' }) });
  assert.match(await t.page.innerText('#app'), /This page is private/);
  await t.page.fill('#pw', 'sunflower');
  await t.page.click('#unlock');
  await t.page.waitForFunction(() => /Ceremony/.test(document.getElementById('app').innerText));
  await t.close();
});

test('a wrong invite code says so; an unknown wedding says not found', async () => {
  const t = await open('w=abc12345&i=nope00', { get_wedding_site: () => ({ ...base, bad_invite: true }) });
  assert.match(await t.page.innerText('#app'), /That code didn’t work/);
  await t.close();
  const t2 = await open('w=missing', { get_wedding_site: () => null });
  assert.match(await t2.page.innerText('#app'), /Wedding not found/);
  await t2.close();
});
