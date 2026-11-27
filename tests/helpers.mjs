// Shared helpers for the plan page tests: a fake near.by API (every request is
// answered here; nothing reaches the real Supabase host), sample plans, and a
// page opener that loads vote.html from disk.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

export const PAGE_URL = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), '../vote.html')).href;
export const SUPA_HOST = 'vieoqoczhqbcxpflyjcp.supabase.co';
export const CODE = 'test123';
export const VOTER = 'voterkey-test';
// Noon in Salt Lake City on Thursday, Nov 26 2026. Fri = 11-27, Sat = 11-28.
export const NOW = '2026-11-26T12:00:00-07:00';
export const FRI = '2026-11-27', SAT = '2026-11-28', SUN = '2026-11-29', TODAY = '2026-11-26';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const clone = x => (x === undefined ? x : JSON.parse(JSON.stringify(x)));

let browser = null;
export async function getBrowser() { browser ??= await chromium.launch(); return browser; }
export async function closeBrowser() { if (browser) await browser.close(); browser = null; }

// A place in the plan. Coordinates are around downtown Salt Lake City.
let optSeq = 0;
export function opt(over = {}) {
  optSeq++;
  return { title: `Deal ${optSeq}`, business: `Place ${optSeq}`, part: null, deal_id: `d${optSeq}`, own: false, lat: 40.76 + optSeq * 0.001, lng: -111.89,
    category: 'restaurant', deal_type: 'always_on', start_time: null, price_info: null, ...over };
}
// A full get_poll answer; anything can be overridden.
export function makePoll(over = {}) {
  const options = over.options || [opt({ title: 'Tacos', business: 'Taco Spot', deal_id: 'a1' })];
  return {
    code: CODE, title: 'Friday plans', closed: false, final: null, closes_at: '2026-11-28T06:00:00Z', plan_day: FRI,
    parts: [], options, counts: options.map(() => 0), voters: [], my_votes: [], voter_count: 0,
    can_add: true, can_add_time: true, rsvp: { in: [], maybe: [], out: [] }, my_rsvp: null, down: [],
    comments: [], times: [], time_counts: [], time_voters: [], time_people: 0, my_times: [], part_times: [],
    activity: [], tickets: [], is_creator: false, is_organizer: false, organizers: [], members: [], my_name: null,
    ...over,
    ...(over.counts ? {} : { counts: (over.options || options).map(() => 0) }),
  };
}
// A row from deals_around (jsonb with a businesses object, as the database returns it).
let dealSeq = 0;
export function aroundRow(over = {}) {
  dealSeq++;
  const { business_name, category, ...rest } = over;
  return { id: `n${dealSeq}`, title: `Nearby ${dealSeq}`, description: null, deal_type: 'always_on', recurring_days: null, valid_from: null, valid_until: null,
    start_time: null, end_time: null, category_tags: [], price_info: null, source_url: null, image_url: null, latitude: 40.761, longitude: -111.89,
    distance_m: 300 + dealSeq, businesses: { name: business_name || `Biz ${dealSeq}`, category: category || 'restaurant', city: 'Salt Lake City' }, ...rest };
}
// A row from deals_near_v3 (flat).
export function nearRow(over = {}) {
  dealSeq++;
  return { deal_id: `t${dealSeq}`, title: `Today ${dealSeq}`, business_name: `Spot ${dealSeq}`, category: 'restaurant', category_tags: [], deal_type: 'always_on',
    recurring_days: null, valid_from: null, valid_until: null, start_time: null, end_time: null, distance_m: 400 + dealSeq, latitude: 40.76, longitude: -111.89, ...over };
}

// A 1x1 PNG, for photos.
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
export const fail = message => ({ __status: 400, __body: { message } });

const pday = (poll, p) => (p && p.date) || poll.plan_day || TODAY;
const sortParts = poll => {
  const order = poll.parts.map((p, i) => ({ p, i })).sort((a, b) => `${pday(poll, a.p)} ${a.p.time || ''}`.localeCompare(`${pday(poll, b.p)} ${b.p.time || ''}`) || a.i - b.i);
  const map = {}; order.forEach((x, k) => { map[x.i] = k; });
  poll.parts = order.map(x => x.p);
  poll.options.forEach(o => { if (o.part != null) o.part = map[o.part]; });
};
const optionFrom = (body, state) => {
  if (body.p_title) return { title: body.p_title, business: body.p_place || null, own: true, lat: body.p_lat ?? null, lng: body.p_lng ?? null, deal_id: null, added_by: body.p_name || null };
  const all = [...Object.values(state.nearby || {}).flat(), ...(state.near || [])];
  const r = all.find(x => (x.id || x.deal_id) === body.p_deal_id) || {};
  return { title: r.title || 'Added', business: (r.businesses && r.businesses.name) || r.business_name || 'Added place', deal_id: body.p_deal_id, own: false,
    lat: r.latitude ?? 40.77, lng: r.longitude ?? -111.88, category: (r.businesses && r.businesses.category) || r.category || null, deal_type: r.deal_type || null, start_time: r.start_time || null, added_by: body.p_name || null };
};

// What the fake database does for each call. Each gets (body, state) and
// returns the new poll (or anything JSON). state.poll is the stored plan.
export const DEFAULT_RPC = {
  get_poll: (b, s) => s.poll,
  deals_around: (b, s) => (s.nearby || {})[b.in_kind] || [],
  deals_near_v3: (b, s) => s.near || [],
  toggle_vote: (b, s) => {
    const p = s.poll, i = b.p_option, had = p.my_votes.includes(i);
    p.my_votes = had ? p.my_votes.filter(x => x !== i) : [...p.my_votes, i];
    p.counts[i] = (p.counts[i] || 0) + (had ? -1 : 1);
    p.voters = had ? p.voters.filter(v => !(v.option === i && v.me)) : [...p.voters, { name: b.p_name || 'Someone', option: i, me: true }];
    p.voter_count = Math.max(p.voter_count, p.my_votes.length ? 1 : 0);
    return p;
  },
  set_down: (b, s) => {
    const p = s.poll, n = b.p_name || 'Someone';
    p.my_rsvp = b.p_status ?? (b.p_down ? 'in' : null); p.i_am_down = !!b.p_down;
    for (const k of ['in', 'maybe', 'out']) p.rsvp[k] = p.rsvp[k].filter(x => x !== n);
    if (p.my_rsvp) p.rsvp[p.my_rsvp].push(n);
    return p;
  },
  set_poll_name: (b, s) => { s.poll.my_name = b.p_name; return s.poll; },
  add_poll_time: (b, s) => {
    const p = s.poll;
    if (!p.times.length && b.p_planned_day) { p.times.push({ day: b.p_planned_day, time: b.p_planned_time, planned: true }); p.time_counts.push(0); }
    if (!p.times.some(t => t.day === b.p_day && t.time === b.p_time)) { p.times.push({ day: b.p_day, time: b.p_time, added_by: b.p_name }); p.time_counts.push(0); }
    return p;
  },
  toggle_time: (b, s) => { const p = s.poll, i = b.p_index; p.my_times = p.my_times.includes(i) ? p.my_times.filter(x => x !== i) : [...p.my_times, i]; return p; },
  toggle_part_time: (b, s) => {
    const p = s.poll, r = p.part_times.find(x => x.part === b.p_part && x.time === b.p_time);
    if (r) { r.mine = !r.mine; r.n += r.mine ? 1 : -1; } else p.part_times.push({ part: b.p_part, time: b.p_time, n: 1, names: [b.p_name || 'Someone'], mine: true, added_by: b.p_name });
    return p;
  },
  add_poll_stop: (b, s) => {
    const p = s.poll;
    p.parts.push({ name: b.p_stop_name || 'Stop', time: b.p_stop_time, ...(b.p_stop_date ? { date: b.p_stop_date } : {}) });
    p.options.push({ ...optionFrom(b, s), part: p.parts.length - 1 }); p.counts.push(0);
    sortParts(p);
    return p;
  },
  add_poll_option: (b, s) => { const p = s.poll; p.options.push({ ...optionFrom(b, s), part: b.p_part ?? null }); p.counts.push(0); return p; },
  remove_poll_stop: (b, s) => {
    const p = s.poll, keep = p.options.map((o, i) => ({ o, i })).filter(x => x.o.part !== b.p_part);
    p.counts = keep.map(x => p.counts[x.i] || 0);
    p.options = keep.map(x => ({ ...x.o, part: x.o.part > b.p_part ? x.o.part - 1 : x.o.part }));
    p.parts.splice(b.p_part, 1);
    return p;
  },
  lock_poll: (b, s) => { s.poll.final = b.p_final; return s.poll; },
  toggle_poll_ticket: (b, s) => {
    const p = s.poll; let t = p.tickets.find(x => x.deal_id === b.p_deal_id);
    if (!t) { t = { deal_id: b.p_deal_id, names: [], mine: false }; p.tickets.push(t); }
    t.mine = !t.mine; t.names = t.mine ? [...t.names, b.p_name || 'Someone'] : t.names.filter(n => n !== (b.p_name || 'Someone'));
    return p;
  },
  add_poll_comment: (b, s) => { const p = s.poll; p.comments.push({ id: p.comments.length + 100, name: b.p_name || 'Someone', body: b.p_body, part: b.p_part ?? null, at: s.now, mine: true }); return p; },
  delete_poll_comment: (b, s) => { s.poll.comments = s.poll.comments.filter(c => c.id !== b.p_id); return s.poll; },
  move_poll_option: (b, s) => s.poll,
  set_how: (b, s) => s.poll,
  set_poll_text: (b, s) => s.poll,
};

// Opens vote.html?p=test123 with a fake API. Options:
//   rpc: { name: (body, state) => result }  overrides DEFAULT_RPC
//   deals: rows for the deals REST lookup; nearby: { events, weekly, ongoing } for deals_around; near: deals_near_v3 rows
//   now: the fixed clock; name: a name saved on this phone; storage: other localStorage keys; timezoneId
export async function openPlan(poll, opts = {}) {
  const b = await getBrowser();
  const context = await b.newContext({ timezoneId: opts.timezoneId || 'America/Denver', viewport: { width: 420, height: 900 } });
  const page = await context.newPage();
  const now = opts.now || NOW;
  const state = { poll: clone(poll), calls: [], blocked: [], dialogs: [], deals: opts.deals || [], nearby: opts.nearby || {}, near: opts.near || [], now: new Date(now).toISOString(), errors: [] };
  const handlers = { ...DEFAULT_RPC, ...(opts.rpc || {}) };
  page.on('pageerror', e => state.errors.push(String(e)));
  page.on('dialog', d => { state.dialogs.push({ type: d.type(), message: d.message() }); (opts.onDialog ? opts.onDialog(d) : d.accept()).catch(() => {}); });
  const storage = { 'nearby.voter': VOTER, ...(opts.name ? { 'nearby.name': opts.name } : {}), ...(opts.storage || {}) };
  await context.addInitScript(s => { try { if (!sessionStorage.getItem('__seeded')) { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); sessionStorage.setItem('__seeded', '1'); } } catch {} }, storage);
  await page.clock.setFixedTime(new Date(now));
  await context.route('**/*', async route => {
    const req = route.request(), url = req.url();
    if (url.startsWith('file:') || url.startsWith('data:')) return route.continue();
    const u = new URL(url);
    if (u.hostname !== SUPA_HOST) { state.blocked.push(url); return route.abort(); }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const reply = (status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (u.pathname.startsWith('/rest/v1/rpc/')) {
      const fn = u.pathname.slice('/rest/v1/rpc/'.length);
      let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch {}
      state.calls.push({ fn, body });
      const h = handlers[fn];
      if (!h) return reply(404, { message: `Could not find the function public.${fn}` });
      let res;
      try { res = await h(body, state); } catch (e) { return reply(500, { message: String(e) }); }
      if (res && res.__status) return reply(res.__status, res.__body);
      if (res && typeof res === 'object' && !Array.isArray(res) && res.code && res !== state.poll && fn !== 'get_poll') state.poll = res;
      return reply(200, clone(res ?? null));
    }
    if (u.pathname.startsWith('/storage/v1/object/public/')) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'image/png' }, body: PIXEL });
    if (u.pathname.startsWith('/storage/v1/object/') && req.method() === 'POST') {
      const path = decodeURIComponent(u.pathname.slice('/storage/v1/object/'.length));
      state.calls.push({ fn: 'upload', body: { path, type: req.headers()['content-type'], size: (req.postDataBuffer() || []).length } });
      if (opts.uploadFails) return reply(400, { message: 'upload failed' });
      return reply(200, { Key: path });
    }
    if (u.pathname === '/rest/v1/deals') { state.calls.push({ fn: 'deals', url }); return reply(200, state.deals); }
    return reply(404, { message: 'not found' });
  });
  await page.goto(`${PAGE_URL}?p=${CODE}`);
  await page.waitForSelector('#app h1');
  const api = {
    page, context, state,
    calls: fn => state.calls.filter(c => c.fn === fn).map(c => c.body),
    // RPC calls other than reads (what the page changed).
    writes: () => state.calls.filter(c => !['get_poll', 'get_poll_bring', 'deals', 'deals_around', 'deals_near_v3'].includes(c.fn)),
    text: sel => page.locator(sel).first().innerText(),
    // The text as written (innerText follows CSS, e.g. upper-case headings).
    raw: async sel => (await page.locator(sel).first().textContent()).trim(),
    // Waits until the named call has been made n times.
    waitCall: async (fn, n = 1, timeout = 4000) => {
      const t0 = Date.now();
      while (state.calls.filter(c => c.fn === fn).length < n) {
        if (Date.now() - t0 > timeout) throw new Error(`no ${fn} call (calls: ${state.calls.map(c => c.fn).join(', ')})`);
        await page.waitForTimeout(25);
      }
      return state.calls.filter(c => c.fn === fn).map(c => c.body)[n - 1];
    },
    // Waits for the nth alert/confirm and returns its text.
    waitDialog: async (n = 1, timeout = 4000) => {
      const t0 = Date.now();
      while (state.dialogs.length < n) {
        if (Date.now() - t0 > timeout) throw new Error('no dialog');
        await page.waitForTimeout(25);
      }
      return state.dialogs[n - 1].message;
    },
    close: async () => {
      if (state.errors.length) throw new Error('page errors: ' + state.errors.join('; '));
      if (state.blocked.some(x => x.includes('supabase'))) throw new Error('a request went to another Supabase host: ' + state.blocked.join(', '));
      await context.close();
    },
  };
  return api;
}

// A plan with stops: Dinner at 5:30pm and Drinks at 8pm on Friday.
export function dinnerDrinks(over = {}) {
  const options = [
    opt({ title: 'Taco Tuesday', business: 'Zest', part: 0, deal_id: 'z1', category: 'restaurant' }),
    opt({ title: 'Pasta night', business: 'Nonna', part: 0, deal_id: 'z2', category: 'restaurant' }),
    opt({ title: '$5 drafts', business: 'Bar X', part: 1, deal_id: 'z3', category: 'bar' }),
  ];
  return makePoll({ title: 'Friday night', parts: [{ name: 'Dinner', time: '17:30' }, { name: 'Drinks', time: '20:00' }], options, ...over });
}
