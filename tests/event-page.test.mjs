// The hosted event page (event.html): what guests see and what it sends.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { getBrowser, closeBrowser, SUPA_HOST, VOTER } from './helpers.mjs';

after(closeBrowser);
const URL_ = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), '../event.html')).href;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

function makeEvent(over = {}) {
  return {
    code: 'ev12345', title: 'Sam turns 30', kind: 'event', is_organizer: false, my_rsvp: null, comments: [], cancelled: false, full: false,
    event: { kind: 'birthday', date: '2026-11-28', start: '19:00', end: '01:00', cover: 'night', place: { title: 'My place' }, address_hidden: true,
      address_private: true, plus_ones: 1, question: 'Any allergies?', potluck: true, show_guests: true, host: 'Alan', note: 'Costumes welcome' },
    heads: { going: 1, maybe: 0, no: 0, heads: 2 }, guests: [{ name: 'Pat', status: 'in', guests: 1 }],
    ...over,
  };
}

async function openEvent(ev, rpc = {}) {
  const b = await getBrowser();
  const context = await b.newContext({ timezoneId: 'America/Denver', viewport: { width: 390, height: 900 } });
  const page = await context.newPage();
  const state = { ev, calls: [], errors: [] };
  page.on('pageerror', e => state.errors.push(String(e)));
  await context.addInitScript(k => { try { localStorage.setItem('nearby.voter', k); } catch {} }, VOTER);
  await page.clock.setFixedTime(new Date('2026-11-26T12:00:00-07:00'));
  await context.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url());
    if (u.protocol === 'file:') return route.continue();
    if (u.hostname !== SUPA_HOST) return route.abort();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const fn = u.pathname.split('/').pop(); let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch {}
    state.calls.push({ fn, body });
    const h = { get_event: () => state.ev, get_poll_bring: () => [], ...rpc }[fn];
    if (!h) return route.fulfill({ status: 404, headers: { ...CORS, 'content-type': 'application/json' }, body: '{"message":"nope"}' });
    const res = await h(body, state);
    if (res && res.__status) return route.fulfill({ status: res.__status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(res.__body) });
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(res ?? null) });
  });
  await page.goto(`${URL_}?e=ev12345`);
  await page.waitForSelector('#app h1');
  return { page, state, close: async () => { if (state.errors.length) throw new Error(state.errors.join('; ')); await context.close(); } };
}

test('a guest sees the event, a hidden address, the going list and the host’s question', async () => {
  const t = await openEvent(makeEvent());
  const text = await t.page.locator('#app').innerText();
  assert.match(text, /Sam turns 30/);
  assert.match(text, /Saturday, Nov 28 · 7pm–1am \(next day\)/);
  assert.match(text, /address is shared with guests who say they’re going/);
  assert.match(text, /2 going/);
  assert.match(text, /Pat \+1/);
  assert.match(text, /Any allergies\?/);
  assert.match(text, /Who’s bringing what/);
  await t.close();
});

test('RSVP sends the name, +1s and answer', async () => {
  const t = await openEvent(makeEvent(), { rsvp_event: (b, s) => { s.ev = { ...s.ev, my_rsvp: b.p_status }; return s.ev; } });
  await t.page.fill('#name', 'Lee');
  await t.page.click('button[aria-label="More guests"]');
  await t.page.fill('#answer', 'No nuts');
  await t.page.click('#step-rsvp .rsvp button:first-child');
  await t.page.waitForSelector('#step-rsvp .rsvp button.on');
  const call = t.state.calls.find(c => c.fn === 'rsvp_event').body;
  assert.deepEqual({ s: call.p_status, n: call.p_name, g: call.p_guests, a: call.p_answer }, { s: 'in', n: 'Lee', g: 1, a: 'No nuts' });
  await t.close();
});

test('a full event says so, and names and notes are escaped', async () => {
  const t = await openEvent(makeEvent({ full: true, title: '<img src=x onerror=alert(1)>', guests: [{ name: '<b>x</b>', status: 'in', guests: 0 }],
    comments: [{ id: 1, name: 'Z', body: '<script>alert(1)</script>' }] }));
  const html = await t.page.locator('#app').innerHTML();
  assert.ok(!/<img src=x/.test(html) && !/<script>alert/.test(html));
  assert.match(await t.page.locator('#app').innerText(), /This event is full/);
  await t.close();
});

test('a cancelled event shows it and has no RSVP; a missing one says not found', async () => {
  let t = await openEvent(makeEvent({ cancelled: true }));
  assert.match(await t.page.locator('#app').innerText(), /This event was cancelled/);
  assert.equal(await t.page.locator('#step-rsvp').count(), 0);
  await t.close();
  t = await openEvent(null);
  assert.match(await t.page.locator('#app').innerText(), /Event not found/);
  await t.close();
});

test('the Add and Post buttons keep their word on one line on a phone', async () => {
  const t = await openEvent(makeEvent());
  await t.page.setViewportSize({ width: 375, height: 800 });
  for (const label of ['Add', 'Post']) {
    const box = await t.page.locator('.row .btn', { hasText: label }).evaluate(b => ({ h: b.getBoundingClientRect().height, w: b.getBoundingClientRect().width, sw: b.scrollWidth }));
    assert.ok(box.h <= 48, `${label} is ${box.h}px tall (wrapped)`);
    assert.ok(box.sw <= box.w + 1, `${label} text overflows`);
  }
  await t.close();
});
