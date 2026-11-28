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

// opts: timezoneId (where the guest is), userAgent (a phone), now (the fixed clock).
async function openEvent(ev, rpc = {}, opts = {}) {
  const b = await getBrowser();
  const context = await b.newContext({ timezoneId: opts.timezoneId || 'America/Denver', viewport: { width: 390, height: 900 }, ...(opts.userAgent ? { userAgent: opts.userAgent } : {}) });
  const page = await context.newPage();
  const state = { ev, calls: [], errors: [] };
  page.on('pageerror', e => state.errors.push(String(e)));
  await context.addInitScript(k => { try { localStorage.setItem('nearby.voter', k); } catch {} }, VOTER);
  await page.clock.setFixedTime(new Date(opts.now || '2026-11-26T12:00:00-07:00'));
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

test('a book club shows the book, what to read, the questions and the snacks list', async () => {
  const t = await openEvent(makeEvent({ title: 'December book club', event: { ...makeEvent().event, kind: 'book_club',
    book: { title: 'Piranesi', author: 'Susanna Clarke', cover_id: 10520611, year: 2020, pages: 272 }, reading: 'The whole book',
    questions: ['Who is the Other?', 'Would you leave the House?'] } }));
  const text = await t.page.locator('#app').innerText();
  assert.match(text, /THE BOOK/);
  assert.match(text, /Piranesi/);
  assert.match(text, /Susanna Clarke · 2020 · 272 pages/);
  assert.match(text, /Read by then: The whole book/);
  assert.match(text, /To talk about/);
  assert.match(text, /Would you leave the House\?/);
  assert.match(text, /Who’s bringing snacks/);
  // The cover comes from Open Library (outside requests are blocked in tests, so the image itself drops out).
  assert.equal(await t.page.evaluate(() => coverUrl(10520611, 'L')), 'https://covers.openlibrary.org/b/id/10520611-L.jpg');
  assert.equal(await t.page.locator('.cover .icon').innerText(), '📚');
  await t.close();
});

// A 12–2am start is that night's: Thursday 12:30am on a Thursday event is early Friday.
const lateEvent = (date, over = {}) => makeEvent({ event: { ...makeEvent().event, date, start: '00:30', end: '02:00', ...over } });

test('a 12:30am start reads as that night and goes on the next calendar day', async () => {
  const t = await openEvent(lateEvent('2026-11-28'));
  assert.match(await t.page.locator('.when').innerText(), /^Saturday night, Nov 28 · 12:30am–2am$/);
  const href = await t.page.locator('a', { hasText: 'Add to calendar' }).getAttribute('href');
  assert.match(href, /dates=20261129T003000\/20261129T020000&ctz=America\/Denver/);
  await t.close();
});

test('calendar runs to the end time, past midnight too', async () => {
  const t = await openEvent(makeEvent()); // Sat 7pm–1am
  const href = await t.page.locator('a', { hasText: 'Add to calendar' }).getAttribute('href');
  assert.match(href, /dates=20261128T190000\/20261129T010000/);
  await t.close();
});

test('a late start isn’t over until it has happened', async () => {
  // Thursday noon: a "Thursday 12:30am" event is tonight (Friday 12:30am), so the RSVP is still open.
  let t = await openEvent(lateEvent('2026-11-26'));
  assert.equal(await t.page.locator('#step-rsvp').count(), 1);
  await t.close();
  // Wednesday's ran this morning (Thursday 12:30–2am): over.
  t = await openEvent(lateEvent('2026-11-25'));
  assert.equal(await t.page.locator('#step-rsvp').count(), 0);
  assert.match(await t.page.locator('#app').innerText(), /How was it\?/);
  await t.close();
});

test('over goes by Utah time wherever the guest is', async () => {
  // 7pm–10pm Thursday in Utah; it's 11pm in Utah (Friday afternoon in Tokyo), so it's over.
  const ev = makeEvent({ event: { ...makeEvent().event, date: '2026-11-26', start: '19:00', end: '22:00' } });
  let t = await openEvent(ev, {}, { timezoneId: 'Asia/Tokyo', now: '2026-11-26T23:00:00-07:00' });
  assert.equal(await t.page.locator('#step-rsvp').count(), 0);
  await t.close();
  // 6pm in Utah (Friday 10am in Tokyo): not yet.
  t = await openEvent(ev, {}, { timezoneId: 'Asia/Tokyo', now: '2026-11-26T18:00:00-07:00' });
  assert.equal(await t.page.locator('#step-rsvp').count(), 1);
  await t.close();
});

test('who’s bringing what: take your own off; a host can take any off; empty says so', async () => {
  const list = [{ id: 1, name: 'Pat', item: 'Chips', mine: false }, { id: 2, name: 'Lee', item: 'Salsa', mine: true }];
  let t = await openEvent(makeEvent(), { get_poll_bring: () => list, remove_poll_bring: b => list.filter(x => x.id !== b.p_id) });
  assert.equal(await t.page.locator('#step-bring button.x').count(), 1); // only your own
  await t.page.click('#step-bring button[aria-label="Take Salsa off the list"]');
  await t.page.waitForFunction(() => !document.querySelector('#step-bring').innerText.includes('Salsa'));
  assert.deepEqual(t.state.calls.find(c => c.fn === 'remove_poll_bring').body, { p_code: 'ev12345', p_voter_key: VOTER, p_id: 2 });
  await t.close();
  t = await openEvent(makeEvent({ is_organizer: true }), { get_poll_bring: () => list });
  assert.equal(await t.page.locator('#step-bring button.x').count(), 2);
  await t.close();
  t = await openEvent(makeEvent());
  assert.match(await t.page.locator('#step-bring').innerText(), /Nothing yet\. Add what you’re bringing\./);
  await t.close();
});

test('bring and note errors show in their own cards, also after the event', async () => {
  const fail = () => ({ __status: 400, __body: { message: 'nope' } });
  let t = await openEvent(makeEvent(), { add_poll_bring: fail });
  await t.page.fill('#bring', 'Cookies');
  await t.page.click('#step-bring .btn');
  await t.page.waitForSelector('#step-bring .err');
  assert.match(await t.page.locator('#step-bring .err').innerText(), /Couldn’t add that/);
  await t.close();
  // After the event (no RSVP card), a failed note still says so.
  t = await openEvent(makeEvent({ event: { ...makeEvent().event, date: '2026-11-20' } }), { add_poll_comment: fail });
  assert.equal(await t.page.locator('#step-rsvp').count(), 0);
  await t.page.fill('#note', 'Great party');
  await t.page.click('#step-notes .btn');
  await t.page.waitForSelector('#step-notes .err');
  assert.match(await t.page.locator('#step-notes .err').innerText(), /Couldn’t post that/);
  await t.close();
});

test('an RSVP never sends more +1s than the event allows', async () => {
  const t = await openEvent(makeEvent({ my_guests: 2, event: { ...makeEvent().event, plus_ones: 0 } }), { rsvp_event: (b, s) => s.ev });
  await t.page.fill('#name', 'Lee');
  await t.page.click('#step-rsvp .rsvp button:first-child');
  for (let i = 0; i < 100 && !t.state.calls.some(c => c.fn === 'rsvp_event'); i++) await new Promise(r => setTimeout(r, 20));
  assert.equal(t.state.calls.find(c => c.fn === 'rsvp_event').body.p_guests, 0);
  await t.close();
});

test('on a phone, the page offers to open the event in the app', async () => {
  let t = await openEvent(makeEvent(), {}, { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' });
  assert.equal(await t.page.locator('#openapp').getAttribute('href'), 'nearby://event/ev12345');
  assert.match(await t.page.locator('#openapp').innerText(), /Open in the near\.by app/);
  await t.close();
  t = await openEvent(makeEvent());
  assert.equal(await t.page.locator('#openapp').count(), 0); // a computer can't open it
  await t.close();
});
