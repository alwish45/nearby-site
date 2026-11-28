// The shared deal page (deal.html): what a friend sees from a shared deal link.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { getBrowser, closeBrowser, SUPA_HOST } from './helpers.mjs';

after(closeBrowser);
const URL_ = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), '../deal.html')).href;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const ID = 'dd489063-864c-49ac-9969-b22d3e39994f';

function deal(over = {}) {
  return { id: ID, title: 'Trivia Wednesday 8pm', description: 'Teams up to 6. Prizes for the top 3.', price_info: 'Free', image_url: null, source_url: null,
    deal_type: 'recurring', recurring_days: [3], valid_from: null, valid_until: null, start_time: '20:00:00', end_time: '23:00:00', is_active: true,
    businesses: { name: 'Quarters', category: 'bar', address: '5 E 400 S', city: 'Salt Lake City', phone: '(801) 555-0100', website: 'https://example.com', menu_url: null },
    ...over };
}

async function open(rows, { id = ID, ua = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile' } = {}) {
  const b = await getBrowser();
  const context = await b.newContext({ timezoneId: 'America/Denver', viewport: { width: 390, height: 900 }, userAgent: ua });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.clock.setFixedTime(new Date('2026-11-26T12:00:00-07:00'));
  await context.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.protocol === 'file:') return route.continue();
    if (u.hostname !== SUPA_HOST) return route.abort();
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(rows) });
  });
  await page.goto(`${URL_}?d=${id}`);
  await page.waitForFunction(() => !/Loading/.test(document.querySelector('#app').textContent));
  const text = await page.locator('main').innerText();
  const openVisible = await page.locator('#openapp').isVisible();
  await context.close();
  return { text, errors, openVisible };
}

test('shows the deal, the place, when it is on, and an Open in app button on a phone', async () => {
  const { text, errors, openVisible } = await open([deal()]);
  assert.deepEqual(errors, []);
  assert.match(text, /Trivia Wednesday 8pm/);
  assert.match(text, /Quarters/);
  assert.match(text, /Wed · 8pm–11pm/);
  assert.match(text, /Free/);
  assert.match(text, /Directions/);
  assert.ok(openVisible);
  // Not on Google Play yet: Android gets a note instead of the App Store.
  assert.match(text, /Coming soon to Android/);
});

test('a one-day event shows its date; an every-day offer says so', async () => {
  let r = await open([deal({ deal_type: 'one_time', recurring_days: [], valid_from: '2026-12-05', valid_until: '2026-12-05', start_time: '19:00:00', end_time: null })]);
  assert.match(r.text, /Sat, Dec 5 · 7pm/);
  r = await open([deal({ deal_type: 'always_on', recurring_days: [], start_time: null, end_time: null })]);
  assert.match(r.text, /Every day/);
});

test('an ended or missing deal says so, with no Open in app button', async () => {
  let r = await open([deal({ valid_until: '2026-11-01' })]);
  assert.match(r.text, /This one has ended/);
  r = await open([]);
  assert.match(r.text, /couldn’t find that deal/);
  assert.equal(r.openVisible, false);
  r = await open([], { id: 'nope' });
  assert.match(r.text, /link looks incomplete/);
});

test('text from the database is shown as text, not HTML', async () => {
  const { text, errors } = await open([deal({ title: '<img src=x onerror="window.x=1">Wings' })]);
  assert.deepEqual(errors, []);
  assert.match(text, /<img src=x/);
});
