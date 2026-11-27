// The near.by shared plan page (vote.html): what friends see and what it sends.
// Run from the repo root: node --test tests/
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { openPlan, closeBrowser, makePoll, opt, dinnerDrinks, aroundRow, nearRow, fail, CODE, VOTER, NOW, FRI, SAT, TODAY } from './helpers.mjs';

after(closeBrowser);

// Opens a plan, runs the checks, and always closes it (failing on page errors).
async function withPlan(poll, opts, fn) {
  if (typeof opts === 'function') { fn = opts; opts = {}; }
  const t = await openPlan(poll, opts);
  try { await fn(t); } finally { await t.close(); }
}
const texts = (t, sel) => t.page.locator(sel).allInnerTexts();
const count = (t, sel) => t.page.locator(sel).count();
// The floating button, then wait for the nearby list to load.
async function openAdd(t) {
  await t.page.click('#fab');
  await t.page.waitForSelector('#step-addstop');
  await t.page.waitForFunction(() => !/Loading what’s on nearby/.test(document.getElementById('step-addstop')?.textContent || ''));
}
const ago = ms => new Date(Date.parse(NOW) - ms).toISOString();

// A plan for Friday with Friday and Saturday to pick from, and stops on Friday only.
function friWithSat(over = {}) {
  return dinnerDrinks({ times: [{ day: FRI, time: '17:30', planned: true }, { day: SAT, time: '17:30' }], time_counts: [0, 0], ...over });
}
// A plan for each day: dinner on Friday or dinner on Saturday.
function eachDay(over = {}) {
  return makePoll({
    title: 'Dinner this weekend', plan_day: FRI,
    parts: [{ name: 'Dinner', time: '18:00', date: FRI }, { name: 'Drinks', time: '20:00', date: FRI }, { name: 'Dinner', time: '18:00', date: SAT }],
    options: [opt({ business: 'Zest', part: 0, deal_id: 'f1', lat: 40.76, lng: -111.89 }), opt({ business: 'Bar X', part: 1, deal_id: 'f2', lat: 40.761, lng: -111.891 }),
      opt({ business: 'Far Away Grill', part: 2, deal_id: 's1', lat: 40.5, lng: -111.6 })],
    times: [{ day: FRI, time: '18:00', planned: true }, { day: SAT, time: '18:00' }], time_counts: [1, 1], time_people: 2,
    ...over,
  });
}

describe('page loads', () => {
  test('a single invite: nothing to vote on, just say if you are in', async () => {
    await withPlan(makePoll({ title: null }), async t => {
      assert.equal(await t.text('h1'), 'Who’s in?');
      assert.match(await t.text('.sub'), /Tap “I’m in” if you’re coming/);
      assert.equal(await t.page.locator('.opt[data-i="0"]').isDisabled(), true);
      assert.equal(await count(t, '.opt[data-i="0"] .n'), 0);
      assert.equal(await count(t, '[data-rsvp]'), 3);
    });
  });

  test('a plain vote: places to tap, a summary, no plan card', async () => {
    const poll = makePoll({ title: 'Where to?', options: [opt({ business: 'A' }), opt({ business: 'B' }), opt({ business: 'C' })] });
    await withPlan(poll, { name: 'Sam' }, async t => {
      assert.match(await t.text('.sub'), /Tap every one you’d be happy with/);
      assert.equal(await t.text('.summary b'), 'No votes yet. Tap every place you’d be happy with.');
      assert.equal(await count(t, '#step-vote'), 1);
      assert.equal(await count(t, '.night-row'), 0);
      assert.equal(await count(t, '.opt[data-i]:not([disabled])'), 3);
    });
  });

  test('a plan with stops: the night card lists each stop', async () => {
    await withPlan(dinnerDrinks(), async t => {
      assert.equal(await t.raw('.box h2'), '🌃 Your night · Fri, Nov 27');
      assert.equal(await count(t, '.night-row'), 2);
      assert.deepEqual(await texts(t, '.part-head .pname'), ['5:30pm', '8pm']);
      assert.equal(await count(t, '#step-day'), 1, 'Which day? is offered for a one-day plan');
    });
  });

  test('a plan for today says Tonight; one with a morning stop says Your day', async () => {
    await withPlan(dinnerDrinks({ plan_day: TODAY }), async t => assert.equal(await t.raw('.box h2'), '🌃 Your night · Tonight'));
    const day = dinnerDrinks({ parts: [{ name: 'Brunch', time: '10:00' }, { name: 'Drinks', time: '20:00' }] });
    await withPlan(day, async t => assert.equal(await t.raw('.box h2'), '☀️ Your day · Fri, Nov 27'));
  });

  test('a multi-day plan: stops grouped under each day, no Which day?', async () => {
    const poll = makePoll({ title: 'Weekend', parts: [{ name: 'Dinner', time: '18:00', date: FRI }, { name: 'Brunch', time: '10:00', date: SAT }],
      options: [opt({ business: 'Zest', part: 0 }), opt({ business: 'Eggs', part: 1 })] });
    await withPlan(poll, async t => {
      assert.equal(await t.raw('.box h2'), '🗓️ The plan · Fri, Nov 27 – Sat, Nov 28');
      assert.deepEqual((await texts(t, 'h3.dayhead')).map(s => s.split('\n')[0]), ['📅 Friday, Nov 27', '📅 Saturday, Nov 28']);
      assert.deepEqual(await texts(t, '.night-row .ntime'), ['Fri\n6pm', 'Sat\n10am']);
      assert.equal(await count(t, '#step-day'), 0);
    });
  });

  test('a plan for each day: the card names both days and Which day? stays', async () => {
    await withPlan(eachDay(), async t => {
      assert.equal(await t.raw('.box h2'), '🗓️ The plan for each day · Fri or Sat');
      assert.equal(await count(t, '#step-day'), 1);
      assert.deepEqual(await texts(t, '#step-day .opt[data-time] .t'), ['📅 Friday, Nov 27', '📅 Saturday, Nov 28']);
    });
  });

  test('a locked plan: set, the picks marked, nothing to vote on', async () => {
    await withPlan(dinnerDrinks({ final: { parts: [1, 2], day: FRI } }), async t => {
      assert.equal(await t.text('.final h2'), '✅ It’s set · Fri, Nov 27');
      assert.match(await t.text('.sub'), /The plan is set/);
      assert.equal(await t.text('#step-in h2'), 'It’s set. Are you in?');
      assert.equal(await count(t, '.opt[data-i]:not([disabled])'), 0);
      assert.match(await t.page.locator('.opt[data-i="1"]').getAttribute('class'), /final-pick/);
      assert.match(await t.page.locator('.opt[data-i="0"]').getAttribute('class'), /dim/);
      assert.equal(await count(t, '#fab'), 0);
      assert.equal(await count(t, '#lockin'), 0);
      assert.equal(await count(t, '.calbtn'), 2);
    });
  });

  test('a vote closed today: says so, no adding (notes stay open for a day)', async () => {
    const poll = makePoll({ closed: true, closes_at: '2026-11-26T06:00:00Z', options: [opt(), opt()] });
    await withPlan(poll, async t => {
      assert.match(await t.text('.sub'), /This vote has closed\./);
      assert.equal(await count(t, '.opt[data-i]:not([disabled])'), 0);
      assert.equal(await count(t, '#fab'), 0);
      assert.equal(await count(t, '#stopopen'), 0);
    });
  });

  test('ended days ago without being locked in: one "ended" card with how the votes stood', async () => {
    const poll = makePoll({ closed: true, closes_at: '2026-11-20T06:00:00Z', options: [opt({ title: 'Tacos' }), opt({ title: 'Pho' })], counts: [1, 3] });
    await withPlan(poll, async t => {
      assert.match(await t.text('.summary'), /This plan has ended[\s\S]*Pho \(3\), Tacos \(1\)/);
      assert.equal(await count(t, '.opt'), 0);
      assert.equal(await count(t, '.rsvp'), 0);
      assert.equal(await count(t, '#fab'), 0);
      assert.equal(await count(t, '#note'), 0);
    });
  });

  test('a plan that does not exist', async () => {
    await withPlan(null, async t => assert.equal(await t.text('h1'), 'Plan not found'));
  });

  test('only the fake API is called: nothing reaches another host', async () => {
    await withPlan(dinnerDrinks(), async t => {
      await t.page.waitForTimeout(200);
      const hosts = new Set(t.state.blocked.map(u => new URL(u).hostname));
      assert.ok([...hosts].every(h => h === 'api.weather.gov'), [...hosts].join());
      assert.deepEqual(t.state.calls.map(c => c.fn), ['get_poll', 'deals']);
      assert.deepEqual(t.calls('get_poll')[0], { p_code: CODE, p_voter_key: VOTER });
    });
  });
});

describe('voting and answering', () => {
  test('tapping a place calls toggle_vote, and tapping it again takes it back', async () => {
    const poll = makePoll({ options: [opt({ business: 'A' }), opt({ business: 'B' })] });
    await withPlan(poll, { name: 'Sam' }, async t => {
      await t.page.click('.opt[data-i="1"]');
      assert.deepEqual(await t.waitCall('toggle_vote'), { p_code: CODE, p_voter_key: VOTER, p_option: 1, p_name: 'Sam' });
      await t.page.waitForSelector('.opt[data-i="1"].mine');
      assert.equal(await t.text('.opt[data-i="1"] .n'), '1 ✓');
      assert.equal(await t.text('.summary b'), '🏆 B leads · 1 of 1');
      await t.page.click('.opt[data-i="1"]');
      assert.equal((await t.waitCall('toggle_vote', 2)).p_option, 1);
      await t.page.waitForSelector('.opt[data-i="1"]:not(.mine)');
    });
  });

  test('in a plan, a vote first checks the stops have not changed', async () => {
    await withPlan(dinnerDrinks(), { name: 'Sam' }, async t => {
      await t.page.click('.opt[data-i="1"]');
      await t.waitCall('toggle_vote');
      const fns = t.state.calls.map(c => c.fn);
      assert.equal(fns[fns.indexOf('toggle_vote') - 1], 'get_poll');
    });
  });

  test('if a stop was added meanwhile, the vote is not sent and the page says what changed', async () => {
    let n = 0;
    const changed = dinnerDrinks({ parts: [{ name: 'Dinner', time: '17:30' }, { name: 'Drinks', time: '20:00' }, { name: 'Late', time: '21:00' }],
      options: [...dinnerDrinks().options, opt({ part: 2 })] });
    await withPlan(dinnerDrinks(), { name: 'Sam', rpc: { get_poll: (b, s) => (++n === 1 ? s.poll : changed) } }, async t => {
      await t.page.click('.opt[data-i="1"]');
      assert.equal(await t.waitDialog(), 'The plan just changed. Someone added a 9pm stop. Have a look, then try again.');
      assert.equal(t.calls('toggle_vote').length, 0);
      assert.equal(await count(t, '.night-row'), 3);
    });
  });

  test('a vote the database refuses shows a plain message', async () => {
    const poll = makePoll({ options: [opt(), opt()] });
    await withPlan(poll, { name: 'Sam', rpc: { toggle_vote: () => fail('This vote is closed') } }, async t => {
      await t.page.click('.opt[data-i="0"]');
      await t.waitCall('toggle_vote');
      assert.equal(await t.waitDialog(), 'This vote has closed.');
    });
  });

  test('RSVP buttons call set_down with the status, and tapping again clears it', async () => {
    await withPlan(dinnerDrinks(), { name: 'Sam' }, async t => {
      await t.page.click('[data-rsvp="in"]');
      assert.deepEqual(await t.waitCall('set_down'), { p_code: CODE, p_voter_key: VOTER, p_down: true, p_name: 'Sam', p_status: 'in' });
      await t.page.waitForSelector('[data-rsvp="in"].on');
      assert.match(await t.text('#step-in'), /1 in/);
      await t.page.click('[data-rsvp="in"]');
      assert.deepEqual(await t.waitCall('set_down', 2), { p_code: CODE, p_voter_key: VOTER, p_down: false, p_name: 'Sam', p_status: null });
      await t.page.click('[data-rsvp="maybe"]');
      const m = await t.waitCall('set_down', 3);
      assert.equal(m.p_status, 'maybe'); assert.equal(m.p_down, false);
    });
  });
});

describe('names', () => {
  test('first tap with no name asks for one, then votes with it', async () => {
    await withPlan(makePoll({ options: [opt(), opt()] }), async t => {
      await t.page.click('.opt[data-i="0"]');
      await t.page.waitForSelector('#askname-t');
      assert.equal(await t.text('#askname-t'), '👋 First, what’s your name?');
      await t.page.fill('#askname-in', 'Ana');
      await t.page.click('#askname-ok');
      assert.equal((await t.waitCall('toggle_vote')).p_name, 'Ana');
      assert.equal(await t.page.evaluate(() => localStorage.getItem('nearby.name')), 'Ana');
      await t.page.waitForSelector('.voting-as');
      assert.equal(await t.text('.voting-as'), 'Voting as Ana · Change');
    });
  });

  test('"Not now" votes as Someone and does not ask again', async () => {
    await withPlan(makePoll({ options: [opt(), opt()] }), async t => {
      await t.page.click('.opt[data-i="0"]');
      await t.page.click('#askname-skip');
      assert.equal((await t.waitCall('toggle_vote')).p_name, null);
      await t.page.click('.opt[data-i="1"]');
      assert.equal((await t.waitCall('toggle_vote', 2)).p_option, 1);
      assert.equal(await count(t, '#askname-t'), 0);
    });
  });

  test('tapping outside the name sheet cancels the vote', async () => {
    await withPlan(makePoll({ options: [opt(), opt()] }), async t => {
      await t.page.click('.opt[data-i="0"]');
      await t.page.waitForSelector('.askname');
      await t.page.mouse.click(200, 40);
      await t.page.waitForTimeout(150);
      assert.equal(await count(t, '.askname'), 0);
      assert.equal(t.calls('toggle_vote').length, 0);
    });
  });

  test('joined without a name: the "Someone" card, one name box, and Save calls set_poll_name', async () => {
    const poll = makePoll({ options: [opt(), opt()], my_votes: [0], counts: [1, 0], voters: [{ name: 'Someone', option: 0 }], voter_count: 1 });
    await withPlan(poll, async t => {
      assert.match(await t.text('.namecard'), /Friends see you as “Someone”/);
      assert.equal(await count(t, '#name'), 1, 'only one name box on the page');
      await t.page.fill('.namecard #name', 'Lee');
      await t.page.click('#savename');
      assert.deepEqual(await t.waitCall('set_poll_name'), { p_code: CODE, p_voter_key: VOTER, p_name: 'Lee' });
      await t.page.waitForSelector('.voting-as');
      assert.equal(await count(t, '.namecard'), 0);
    });
  });

  test('a name saved on this phone is put on answers given without one', async () => {
    const poll = makePoll({ options: [opt(), opt()], my_votes: [1], counts: [0, 1], voter_count: 1 });
    await withPlan(poll, { name: 'Sam' }, async t => {
      assert.deepEqual(await t.waitCall('set_poll_name'), { p_code: CODE, p_voter_key: VOTER, p_name: 'Sam' });
      await t.page.waitForTimeout(200);
      assert.equal(t.calls('set_poll_name').length, 1);
    });
  });

  test('a note with a name typed in the notes box posts with that name', async () => {
    await withPlan(makePoll({ options: [opt(), opt()] }), async t => {
      await t.page.fill('#name', 'Kim');
      await t.page.fill('#note', 'I can only do after 7');
      await t.page.click('#postnote');
      assert.deepEqual(await t.waitCall('add_poll_comment'), { p_code: CODE, p_voter_key: VOTER, p_name: 'Kim', p_body: 'I can only do after 7' });
    });
  });
});

describe('where it stands', () => {
  function fourStops() {
    const o = (part, business) => opt({ part, business });
    return makePoll({
      parts: [{ name: 'Brunch', time: '10:00' }, { name: 'Lunch', time: '12:00' }, { name: 'Dinner', time: '18:00' }, { name: 'Drinks', time: '21:00' }],
      options: [o(0, 'Eggs'), o(1, 'L1'), o(1, 'L2'), o(2, 'D1'), o(2, 'D2'), o(3, 'B1'), o(3, 'B2')], counts: [0, 2, 1, 1, 1, 0, 0], voter_count: 3,
    });
  }
  test('each stop: only option, leading, tied, needs votes', async () => {
    await withPlan(fourStops(), async t => {
      assert.deepEqual(await texts(t, '.night-row .stand'), ['✅ The only option here', '🏆 Leading · 2 votes · 2 options', '⚖️ Tied at 1 vote · one more settles it', '❓ Needs votes · 2 options']);
      assert.deepEqual(await texts(t, '.night-row .grow > .t'), ['Eggs', 'L1', 'Tied: D1 or D2', 'Still voting']);
      assert.equal(await t.text('.standfoot'), 'Still open: 2 stops. Vote or suggest to settle them.');
      assert.match(await t.page.locator('.standfoot').getAttribute('class'), /open/);
    });
  });

  test('a time friends suggested is ahead of the planned one', async () => {
    const poll = dinnerDrinks({ counts: [1, 0, 0], part_times: [
      { part: 1, time: '21:00', n: 2, names: ['Ann', 'Bo'], mine: false, added_by: 'Ann' },
      { part: 0, time: '18:00', n: 1, names: ['Cy'], mine: false, added_by: 'Cy' }] });
    await withPlan(poll, async t => {
      assert.deepEqual(await texts(t, '.night-row .stand'), ['🏆 Leading · 1 vote · 2 options', '⚖️ The time may change']);
      assert.deepEqual(await texts(t, '.night-row .stand + .who'), ['🕒 Also suggested: 6pm', '🕒 9pm is ahead of 8pm']);
      assert.equal(await t.text('.standfoot'), 'Still open: 1 stop. Vote or suggest to settle it.');
      assert.match(await t.text('#step-part-1 + .ptimes'), /⭐ 9pm works for the most so far/);
    });
  });

  test('every stop picked: ready to lock in (organizer and friend wording)', async () => {
    const poll = dinnerDrinks({ counts: [2, 1, 0] });
    await withPlan(poll, async t => {
      assert.equal(await t.text('.standfoot'), 'Every stop has a pick. The organizers lock it in.');
      assert.match(await t.page.locator('.standfoot').getAttribute('class'), /ok/);
    });
    await withPlan({ ...poll, is_organizer: true }, async t => assert.equal(await t.text('.standfoot'), 'Every stop has a pick. Lock it in below when the group has decided.'));
  });

  test('a plan for each day: a tied day is still open; a leading day counts', async () => {
    await withPlan(eachDay(), async t => {
      assert.equal(await t.text('.standfoot'), '📅 The day is tied\nStill open: the day. Tick the days that work for you.');
    });
    await withPlan(eachDay({ time_counts: [2, 1] }), async t => {
      assert.equal(await t.text('.standfoot'), '📅 Fri, Nov 27 works for the most people · its plan is the one that counts\nEvery stop has a pick. The organizers lock it in.');
    });
  });
});

describe('what’s happened', () => {
  const activity = [
    { line: 'Ann voted for Zest', at: ago(3 * 3600e3) }, { line: 'Bo is in', at: ago(2 * 3600e3) },
    { line: 'Cy added Nonna', at: ago(30 * 60e3) }, { line: 'Dee suggested 9pm', at: ago(5 * 60e3) },
  ];
  test('lines since you last looked are marked New, with a bar at the top', async () => {
    await withPlan(dinnerDrinks({ activity }), { storage: { [`nearby.seen.${CODE}`]: String(Date.parse(NOW) - 3600e3) } }, async t => {
      assert.equal(await t.text('.newbar'), '🔔 2 new since you last looked ›');
      assert.equal(await t.page.locator('.newbar').getAttribute('href'), '#activity');
      assert.match(await t.page.locator('#activity h2').textContent(), /What’s happened · 2 new/);
      assert.deepEqual(await texts(t, '.actrow span:first-child'), ['Dee suggested 9pm', 'Cy added Nonna', 'Bo is in', 'Ann voted for Zest']);
      assert.equal(await count(t, '.actrow.new'), 2);
      assert.equal(await t.text('.actrow.new .who'), '5 min ago');
    });
  });

  test('first visit: nothing is New; leaving the page remembers when', async () => {
    await withPlan(dinnerDrinks({ activity }), async t => {
      assert.equal(await count(t, '.newbar'), 0);
      assert.equal(await count(t, '.actrow.new'), 0);
      await t.page.evaluate(() => dispatchEvent(new Event('pagehide')));
      assert.equal(await t.page.evaluate(k => localStorage.getItem(k), `nearby.seen.${CODE}`), String(Date.parse(NOW)));
    });
  });

  test('more than five lines fold behind "Show all"', async () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ line: `Thing ${i}`, at: ago((10 - i) * 60e3) }));
    await withPlan(dinnerDrinks({ activity: many }), async t => {
      assert.equal(await count(t, '.actrow'), 5);
      await t.page.click('#actmore');
      assert.equal(await count(t, '.actrow'), 7);
      assert.equal(await t.text('#actmore'), 'Show less');
    });
  });
});

describe('add something to the plan', () => {
  const jazz = () => aroundRow({ id: 'jz', title: 'Jazz night', business_name: 'Blue Note', deal_type: 'limited_run', valid_from: FRI, valid_until: FRI, start_time: '19:00:00', category_tags: ['music'], category: 'bar' });

  test('the floating button opens the add box and loads what is on that day', async () => {
    const poll = dinnerDrinks();
    await withPlan(poll, { name: 'Sam', nearby: { events: [jazz()] } }, async t => {
      await openAdd(t);
      await t.page.waitForSelector('#step-addstop');
      assert.equal(await count(t, '#fab'), 0, 'the button hides while the box is open');
      await t.waitCall('deals_around', 3);
      assert.deepEqual(t.calls('deals_around').map(b => b.in_kind).sort(), ['events', 'ongoing', 'weekly']);
      const at = poll.options[2];
      assert.equal(t.calls('deals_around')[0].in_lat, at.lat);
      await t.page.waitForSelector('.pick');
      assert.deepEqual(await texts(t, '.pick .grow > .t'), ['Jazz night']);
      assert.match(await t.text('.feed .who'), /What’s on Fri, Nov 27/);
      await t.page.click('#stopclose');
      assert.equal(await count(t, '#step-addstop'), 0);
      assert.equal(await count(t, '#fab'), 1);
    });
  });

  test('your own event at a time of its own calls add_poll_stop', async () => {
    await withPlan(dinnerDrinks(), { name: 'Sam' }, async t => {
      await openAdd(t);
      await t.page.fill('#owntitle', 'Bowling');
      await t.page.click('#ownadd');
      await t.page.waitForSelector('#when-t');
      assert.equal(await t.text('#when-t'), 'When for Bowling?');
      assert.equal(await t.text('#when-ok'), 'Suggest it at 8pm');
      await t.page.click('#when-up');
      assert.equal(await t.text('#when-ok'), 'Suggest it at 8:30pm');
      await t.page.click('#when-ok');
      const b = await t.waitCall('add_poll_stop');
      assert.deepEqual(b, { p_code: CODE, p_voter_key: VOTER, p_where: 'time', p_name: 'Sam', p_title: 'Bowling', p_place: null, p_lat: null, p_lng: null,
        p_stop_name: 'Bowling', p_stop_time: '20:30', p_main_name: null, p_main_time: null });
      assert.equal(t.calls('add_poll_time').length, 0);
      await t.page.waitForSelector('.toast');
      assert.equal(await t.text('.toast'), 'Added at 8:30pm · friends can vote on it');
      assert.equal(await count(t, '.night-row'), 3);
    });
  });

  test('"＋ Another day": a new day is added to Which day? first, then the stop on that day', async () => {
    await withPlan(dinnerDrinks(), { name: 'Sam' }, async t => {
      await openAdd(t);
      await t.page.fill('#owntitle', 'Bowling');
      await t.page.click('#ownadd');
      await t.page.click('#when-moredays');
      assert.equal(await count(t, '[data-wday]'), 14);
      await t.page.click(`[data-wday="${SAT}"]`);
      await t.page.click('#when-ok');
      const stop = await t.waitCall('add_poll_stop');
      assert.deepEqual(t.calls('add_poll_time')[0], { p_code: CODE, p_voter_key: VOTER, p_day: SAT, p_time: '17:30', p_name: 'Sam', p_planned_day: FRI, p_planned_time: '17:30' });
      const fns = t.state.calls.map(c => c.fn);
      assert.ok(fns.indexOf('add_poll_time') < fns.indexOf('add_poll_stop'));
      assert.equal(stop.p_stop_date, SAT);
      assert.equal(stop.p_stop_time, '20:00');
      assert.equal(stop.p_where, 'time');
    });
  });

  test('your own event at the same time as a stop joins that stop', async () => {
    await withPlan(dinnerDrinks(), { name: 'Sam' }, async t => {
      await openAdd(t);
      await t.page.click('[data-ownidea="Picnic"]');
      await t.page.click('#ownadd');
      await t.page.click('[data-wpart="0"]');
      assert.equal(await t.text('#when-ok'), 'Add as an option at 5:30pm');
      await t.page.click('#when-ok');
      assert.deepEqual(await t.waitCall('add_poll_option'), { p_code: CODE, p_voter_key: VOTER, p_name: 'Sam', p_part: 0, p_title: 'Picnic', p_place: null, p_lat: null, p_lng: null });
      assert.equal(t.calls('add_poll_stop').length, 0);
    });
  });

  test('a listed event is suggested at its own start time', async () => {
    await withPlan(dinnerDrinks(), { name: 'Sam', nearby: { events: [jazz()] } }, async t => {
      await openAdd(t);
      await t.page.click('.pick .plus[data-id="jz"]');
      await t.page.waitForSelector('#when-t');
      assert.equal(await t.text('#when-t'), 'When for Blue Note?');
      assert.equal(await t.text('#when-ok'), 'Suggest it at 7pm');
      await t.page.click('#when-ok');
      const b = await t.waitCall('add_poll_stop');
      assert.equal(b.p_deal_id, 'jz'); assert.equal(b.p_stop_time, '19:00'); assert.equal(b.p_stop_name, 'Show'); assert.equal(b.p_where, 'time');
    });
  });

  test('cancelling the When sheet adds nothing', async () => {
    await withPlan(dinnerDrinks(), { name: 'Sam' }, async t => {
      await openAdd(t);
      await t.page.fill('#owntitle', 'Bowling');
      await t.page.click('#ownadd');
      await t.page.click('#when-no');
      await t.page.waitForTimeout(150);
      assert.equal(t.writes().length, 0);
      assert.equal(await t.page.inputValue('#owntitle'), 'Bowling', 'the typed title is kept');
    });
  });
});

describe('suggest another place for a stop', () => {
  const rows = () => ({
    weekly: [aroundRow({ title: 'Burger deal', business_name: 'Burger Barn', deal_type: 'recurring', recurring_days: [], start_time: '17:00:00', end_time: '21:00:00', category_tags: ['food'] })],
    events: [aroundRow({ title: 'Pancake breakfast', business_name: 'Flapjacks', deal_type: 'limited_run', valid_from: FRI, valid_until: FRI, start_time: '09:00:00', end_time: '11:00:00', category_tags: ['food', 'brunch'] })],
    ongoing: [aroundRow({ title: 'Art exhibit', business_name: 'City Museum', deal_type: 'always_on', category_tags: ['art'], category: 'museum' })],
  });
  test('a 5:30pm dinner stop starts on Evening + Food, and "Show everything" clears them', async () => {
    await withPlan(dinnerDrinks(), { name: 'Sam', nearby: rows() }, async t => {
      await t.page.click('[data-suggest="0"]');
      await t.page.waitForSelector('.pick');
      assert.equal(await count(t, '[data-slot="evening"].on'), 1);
      assert.equal(await count(t, '[data-cat="food"].on'), 1);
      assert.equal(await t.text('.autoline span'), 'Picked for 5:30pm: Evening · Food');
      assert.deepEqual(await texts(t, '.pick .grow > .t'), ['Burger deal']);
      await t.page.click('#feedclear');
      assert.equal(await count(t, '.autoline'), 0);
      assert.equal(await count(t, '[data-slot=""].on'), 1);
      assert.equal(await count(t, '[data-cat=""].on'), 1);
      assert.deepEqual((await texts(t, '.pick .grow > .t')).sort(), ['Art exhibit', 'Burger deal', 'Pancake breakfast']);
    });
  });

  test('adding a place from a stop’s list joins that stop', async () => {
    await withPlan(dinnerDrinks(), { name: 'Sam', nearby: rows() }, async t => {
      await t.page.click('[data-suggest="0"]');
      await t.page.waitForSelector('.pick');
      const id = await t.page.locator('.pick .plus').first().getAttribute('data-id');
      await t.page.click('.pick .plus');
      await t.page.waitForSelector('#when-t');
      assert.equal(await t.text('#when-ok'), 'Add as an option at 5:30pm');
      await t.page.click('#when-ok');
      assert.deepEqual(await t.waitCall('add_poll_option'), { p_code: CODE, p_voter_key: VOTER, p_deal_id: id, p_name: 'Sam', p_part: 0 });
      await t.page.waitForSelector('.toast');
      assert.equal(await t.text('.toast'), 'Added to 5:30pm · friends can vote on it');
    });
  });

  test('a Saturday stop shows only what is on Saturday (and Friday’s shows Friday’s)', async () => {
    const poll = makePoll({ parts: [{ name: 'Hang', time: '19:00', date: FRI }, { name: 'Hang', time: '19:00', date: SAT }],
      options: [opt({ part: 0, business: 'A' }), opt({ part: 1, business: 'B' })] });
    const nearby = {
      events: [aroundRow({ title: 'Fri show', deal_type: 'limited_run', valid_from: FRI, valid_until: FRI }), aroundRow({ title: 'Sat show', deal_type: 'limited_run', valid_from: SAT, valid_until: SAT })],
      weekly: [aroundRow({ title: 'Friday trivia', deal_type: 'recurring', recurring_days: [5] }), aroundRow({ title: 'Saturday karaoke', deal_type: 'recurring', recurring_days: [6] })],
    };
    await withPlan(poll, { name: 'Sam', nearby }, async t => {
      await t.page.click('[data-suggest="1"]');
      await t.page.click('#feedclear'); // the stop's own filters (Evening · Food) aside
      await t.page.waitForSelector('.pick');
      assert.match(await t.text('.feed .who'), /What’s on Sat, Nov 28/);
      assert.deepEqual((await texts(t, '.pick .grow > .t')).sort(), ['Sat show', 'Saturday karaoke']);
      await t.page.click('[data-suggest="0"]');
      await t.page.waitForSelector('.feed');
      await t.page.waitForFunction(() => /Fri, Nov 27/.test(document.querySelector('.feed .who')?.textContent || ''));
      await t.page.click('#feedclear');
      assert.deepEqual((await texts(t, '.pick .grow > .t')).sort(), ['Fri show', 'Friday trivia']);
    });
  });

  test('the Lunch time leaves out things that are not food, and drink deals', async () => {
    const poll = makePoll({ plan_day: TODAY, parts: [{ name: 'Hang', time: '12:30' }], options: [opt({ part: 0 })] });
    const near = [
      nearRow({ title: 'Lunch special', business_name: 'Deli', start_time: '11:00:00', end_time: '14:00:00', category_tags: ['food'] }),
      nearRow({ title: '$5 drafts', business_name: 'Pub', start_time: '11:00:00', end_time: '14:00:00', category_tags: ['food', 'drinks'] }),
      nearRow({ title: 'Pottery class', business_name: 'Clay Co', start_time: '13:00:00', end_time: '15:00:00', category_tags: ['family'] }),
      nearRow({ title: 'Whiskey flight', business_name: 'Still', start_time: '12:00:00', end_time: '16:00:00', category_tags: ['food'] }),
    ];
    await withPlan(poll, { name: 'Sam', near, now: '2026-11-26T09:00:00-07:00' }, async t => {
      await openAdd(t);
      await t.waitCall('deals_near_v3');
      await t.page.waitForSelector('.pick');
      assert.equal(await count(t, '.pick'), 4);
      await t.page.click('[data-slot="lunch"]');
      assert.deepEqual(await texts(t, '.pick .grow > .t'), ['Lunch special']);
    });
  });
});

describe('a plan for each day', () => {
  test('day rows offer "＋ Plan Sat", "＋ Add to Fri" and "↪ Bring over from Fri"', async () => {
    await withPlan(friWithSat(), async t => {
      const rows = await texts(t, '#step-day .dayplan');
      assert.match(rows[0], /2 stops: 5:30pm, 8pm/);
      assert.match(rows[0], /＋ Add to Fri/);
      assert.doesNotMatch(rows[0], /Bring over/);
      assert.match(rows[1], /＋ Plan Sat/);
      assert.equal(await count(t, `[data-planday="${SAT}"]`), 1);
      assert.equal(await count(t, `[data-bringfrom="${FRI}|${SAT}"]`), 1);
      assert.equal(await t.text(`[data-bringfrom="${FRI}|${SAT}"]`), '↪ Bring over from Fri');
    });
  });

  test('"＋ Plan Sat" adds your own stop on Saturday', async () => {
    await withPlan(friWithSat(), { name: 'Sam' }, async t => {
      await t.page.click(`[data-planday="${SAT}"]`);
      await t.page.waitForSelector('#step-addstop');
      assert.match(await t.page.locator('#step-addstop h2').textContent(), /Add something to Saturday, Nov 28/);
      await t.page.fill('#owntitle', 'Bowling');
      await t.page.click('#ownadd');
      assert.equal(await count(t, `[data-wday="${SAT}"].on`), 1);
      assert.equal(await t.text('#when-ok'), 'Suggest it at 5:30pm');
      await t.page.click('#when-ok');
      const b = await t.waitCall('add_poll_stop');
      assert.equal(b.p_stop_date, SAT); assert.equal(b.p_stop_time, '17:30'); assert.equal(b.p_title, 'Bowling');
      assert.equal(t.calls('add_poll_time').length, 0, 'Saturday is already a day to pick');
      await t.page.waitForSelector('h3.dayhead');
      assert.equal(await t.raw('.box h2'), '🗓️ The plan for each day · Fri or Sat');
    });
  });

  test('bring over: the sheet lists Friday’s stops and copies them to Saturday', async () => {
    await withPlan(friWithSat(), { name: 'Sam' }, async t => {
      await t.page.click(`[data-bringfrom="${FRI}|${SAT}"]`);
      await t.page.waitForSelector('#bring-t');
      assert.equal(await t.text('#bring-t'), 'Bring over to Saturday, Nov 28');
      assert.deepEqual(await texts(t, '[data-bpi] .t'), ['✓ 5:30pm · Dinner', '✓ 8pm · Drinks']);
      assert.deepEqual(await texts(t, '[data-bpi] .m'), ['Zest, Nonna', 'Bar X']);
      assert.equal(await t.text('#bring-ok'), 'Bring 2 stops over');
      await t.page.click('#bring-ok');
      await t.waitCall('add_poll_stop', 2);
      const writes = t.writes().map(c => [c.fn, c.body]);
      assert.deepEqual(writes.map(([f]) => f), ['add_poll_stop', 'add_poll_option', 'add_poll_stop']);
      assert.deepEqual(writes[0][1], { p_code: CODE, p_voter_key: VOTER, p_where: 'time', p_name: 'Sam', p_stop_date: SAT, p_stop_time: '17:30', p_stop_name: 'Dinner', p_deal_id: 'z1' });
      assert.deepEqual(writes[1][1], { p_code: CODE, p_voter_key: VOTER, p_name: 'Sam', p_part: 2, p_deal_id: 'z2' });
      assert.equal(writes[2][1].p_stop_date, SAT); assert.equal(writes[2][1].p_stop_time, '20:00'); assert.equal(writes[2][1].p_deal_id, 'z3');
      await t.page.waitForSelector('.toast');
      assert.equal(await t.text('.toast'), 'Brought 2 stops over to Sat');
    });
  });

  test('bring over only what you leave ticked', async () => {
    await withPlan(friWithSat(), { name: 'Sam' }, async t => {
      await t.page.click(`[data-bringfrom="${FRI}|${SAT}"]`);
      await t.page.click('[data-bpi="0"]');
      assert.equal(await t.text('#bring-ok'), 'Bring 1 stop over');
      await t.page.click('#bring-ok');
      await t.waitCall('add_poll_stop');
      await t.page.waitForSelector('.toast');
      assert.deepEqual(t.writes().map(c => c.fn), ['add_poll_stop']);
      assert.equal(t.calls('add_poll_stop')[0].p_stop_name, 'Drinks');
    });
  });

  test('the card groups stops by day, with no distance or route across days', async () => {
    await withPlan(eachDay(), async t => {
      assert.deepEqual(await texts(t, '.night-row .ntime'), ['Fri\n6pm', 'Fri\n8pm', 'Sat\n6pm']);
      assert.equal(await count(t, '.night-row + .hop, .hop'), 1, 'only Friday’s two stops have a hop');
      assert.equal(await count(t, 'text=The whole route in Maps'), 0);
      assert.equal(await count(t, 'h3.dayhead'), 2);
      assert.equal(await count(t, '.hopbetween'), 1);
    });
  });
});

describe('tickets', () => {
  const show = (over = {}) => makePoll({ parts: [{ name: 'Show', time: '19:00' }],
    options: [opt({ title: 'Big Band Live', business: 'Red Butte', deal_type: 'limited_run', start_time: '19:00:00', deal_id: 'e1', part: 0, category: 'venue' })],
    tickets: [{ deal_id: 'e1', names: ['Ana'], mine: false }], ...over });
  test('a ticketed event shows who has tickets, a Get tickets link, and "I have my ticket"', async () => {
    await withPlan(show(), { name: 'Sam', deals: [{ id: 'e1', title: 'Big Band Live', deal_type: 'limited_run', start_time: '19:00:00', source_url: 'https://tix.example.com/bb', businesses: {} }] }, async t => {
      assert.equal(await t.text('.night-row .grow > .t'), 'Big Band Live at Red Butte');
      assert.equal(await t.text('.tix .who'), '🎟️ Ana has a ticket');
      await t.page.waitForSelector('.tix a');
      assert.equal(await t.page.locator('.tix a').getAttribute('href'), 'https://tix.example.com/bb');
      assert.equal(await t.text('.tix a'), 'Get tickets ›');
      await t.page.click('[data-ticket="e1"]');
      assert.deepEqual(await t.waitCall('toggle_poll_ticket'), { p_code: CODE, p_voter_key: VOTER, p_deal_id: 'e1', p_name: 'Sam' });
      await t.page.waitForSelector('[data-ticket="e1"].on');
      assert.equal(await t.text('[data-ticket="e1"]'), '✓ I have my ticket');
      assert.equal(await t.text('.tix .who'), '🎟️ Ana, Sam have tickets');
    });
  });

  test('priced in tickets counts too; a non-https link is not shown; a plain place has no ticket box', async () => {
    const poll = show({ options: [opt({ title: 'Comedy', business: 'Wiseguys', deal_type: 'recurring', price_info: 'Tickets from $20', deal_id: 'e2', part: 0 })], tickets: [] });
    await withPlan(poll, { deals: [{ id: 'e2', source_url: 'http://insecure.example.com', businesses: {} }] }, async t => {
      await t.waitCall('deals');
      await t.page.waitForTimeout(150);
      assert.equal(await t.text('.tix .who'), '🎟️ Nobody’s said they have a ticket yet');
      assert.equal(await count(t, '.tix a'), 0);
    });
    await withPlan(dinnerDrinks(), async t => assert.equal(await count(t, '.tix'), 0));
  });
});

describe('organizers', () => {
  test('friends (not organizers) see no organizer controls', async () => {
    await withPlan(dinnerDrinks({ counts: [2, 1, 0] }), async t => {
      for (const sel of ['#lockin', '#edittoggle', '#invitemore', '#unlockbtn', '[data-rmstop]']) assert.equal(await count(t, sel), 0, sel);
    });
    await withPlan(dinnerDrinks({ final: { parts: [0, 2], day: FRI } }), async t => assert.equal(await count(t, '#unlockbtn'), 0));
  });

  test('the creator is an organizer unless the database says otherwise', async () => {
    await withPlan(dinnerDrinks({ is_organizer: undefined, is_creator: true }), async t => {
      assert.equal(await count(t, '#lockin'), 1);
      assert.equal(await count(t, '#invitemore'), 1);
    });
    await withPlan(dinnerDrinks({ is_organizer: false, is_creator: true }), async t => assert.equal(await count(t, '#lockin'), 0));
  });

  test('"⭐ Also organizing" names the co-organizers, even before anyone answers', async () => {
    await withPlan(dinnerDrinks({ organizers: ['Bo', 'Cy'], voters: [{ name: 'Ann', option: 0 }], counts: [1, 0, 0] }), async t => {
      assert.equal(await t.text('.people + .who'), '⭐ Also organizing: Bo, Cy');
    });
    await withPlan(dinnerDrinks({ organizers: ['Bo'] }), async t => {
      assert.equal(await t.text('text=Also organizing'), '⭐ Also organizing: Bo');
    });
  });

  test('lock it in with clear leaders sends the winning place at each stop and the day', async () => {
    await withPlan(dinnerDrinks({ counts: [2, 1, 0], is_organizer: true }), async t => {
      await t.page.click('#lockin');
      const b = await t.waitCall('lock_poll');
      assert.deepEqual(b, { p_code: CODE, p_creator_key: VOTER, p_final: { parts: [0, 2], day: FRI } });
      assert.equal(t.state.dialogs.at(-1).message, 'Lock it in? Voting stops and everyone is told the plan.');
      await t.page.waitForSelector('.final');
      assert.equal(await count(t, '#unlockbtn'), 1);
      assert.equal(await count(t, '#lockin'), 0);
    });
  });

  test('lock it in on a tie asks which place', async () => {
    await withPlan(dinnerDrinks({ counts: [1, 1, 0], is_organizer: true }), async t => {
      await t.page.click('#lockin');
      await t.page.waitForSelector('#pick-t');
      assert.equal(await t.text('#pick-t'), '5:30pm · Dinner');
      assert.match(await t.text('.askname .m'), /It’s a tie/);
      assert.equal(await t.page.locator('#pick-ok').isDisabled(), true);
      await t.page.click('.askname [data-k="1"]');
      await t.page.click('#pick-ok');
      assert.deepEqual((await t.waitCall('lock_poll')).p_final, { parts: [1, 2], day: FRI });
    });
  });

  test('cancelling the pick locks nothing', async () => {
    await withPlan(dinnerDrinks({ counts: [1, 1, 0], is_organizer: true }), async t => {
      await t.page.click('#lockin');
      await t.page.click('#pick-no');
      await t.page.waitForTimeout(150);
      assert.equal(t.calls('lock_poll').length, 0);
      assert.equal(t.state.dialogs.length, 0);
    });
  });

  test('lock it in with a tied day asks which day', async () => {
    await withPlan(friWithSat({ counts: [2, 0, 0], time_counts: [2, 2], is_organizer: true }), async t => {
      await t.page.click('#lockin');
      await t.page.waitForSelector('#pick-t');
      assert.equal(await t.text('#pick-t'), 'Which day?');
      assert.deepEqual(await texts(t, '.askname [data-k] .t'), ['Friday, Nov 27', 'Saturday, Nov 28']);
      await t.page.click('.askname [data-k="1"]');
      await t.page.click('#pick-ok');
      assert.deepEqual((await t.waitCall('lock_poll')).p_final, { parts: [0, 2], day: SAT });
    });
  });

  test('lock it in uses the times the group picked when the organizer agrees', async () => {
    const poll = dinnerDrinks({ counts: [2, 1, 0], is_organizer: true, part_times: [{ part: 1, time: '21:00', n: 3, names: ['A', 'B', 'C'], mine: false }] });
    await withPlan(poll, async t => {
      await t.page.click('#lockin');
      const b = await t.waitCall('lock_poll');
      assert.match(t.state.dialogs[0].message, /8pm → 9pm/);
      assert.deepEqual(b.p_final, { parts: [0, 2], times: [null, '21:00'], day: FRI });
    });
  });

  test('a plain vote locks in the leading place', async () => {
    const poll = makePoll({ options: [opt(), opt(), opt()], counts: [0, 2, 1], is_organizer: true });
    await withPlan(poll, async t => {
      await t.page.click('#lockin');
      assert.deepEqual((await t.waitCall('lock_poll')).p_final, { option: 1, day: FRI });
    });
  });

  test('a plan for each day: keeping the leading day takes the other day’s stops out first', async () => {
    const poll = eachDay({ time_counts: [1, 2], is_organizer: true });
    await withPlan(poll, async t => {
      await t.page.click('#lockin');
      await t.page.waitForSelector('#pick-t');
      assert.equal(await t.text('#pick-t'), 'Which day’s plan?');
      await t.page.click('#pick-ok'); // Saturday is picked already
      const b = await t.waitCall('lock_poll');
      assert.deepEqual(t.calls('remove_poll_stop'), [{ p_code: CODE, p_creator_key: VOTER, p_part: 1 }, { p_code: CODE, p_creator_key: VOTER, p_part: 0 }]);
      assert.deepEqual(b.p_final, { parts: [0], day: SAT });
    });
  });

  test('a plan for each day: keeping the original day (stops with no date) locks that day, not the leading one', async () => {
    const poll = makePoll({ plan_day: FRI, is_organizer: true,
      parts: [{ name: 'Dinner', time: '18:00' }, { name: 'Dinner', time: '18:00', date: SAT }],
      options: [opt({ business: 'Zest', part: 0 }), opt({ business: 'Grill', part: 1 })],
      times: [{ day: FRI, time: '18:00', planned: true }, { day: SAT, time: '18:00' }], time_counts: [1, 2], time_people: 3 });
    await withPlan(poll, async t => {
      assert.equal(await t.raw('.box h2'), '🗓️ The plan for each day · Fri or Sat');
      await t.page.click('#lockin');
      await t.page.waitForSelector('#pick-t');
      await t.page.click('.askname [data-k="0"]'); // Friday
      await t.page.click('#pick-ok');
      const b = await t.waitCall('lock_poll');
      assert.deepEqual(t.calls('remove_poll_stop').map(x => x.p_part), [1]);
      assert.deepEqual(b.p_final, { parts: [0], day: FRI });
    });
  });

  test('unlock sends lock_poll with no final plan', async () => {
    await withPlan(dinnerDrinks({ final: { parts: [0, 2], day: FRI }, is_organizer: true }), async t => {
      await t.page.click('#unlockbtn');
      assert.deepEqual(await t.waitCall('lock_poll'), { p_code: CODE, p_creator_key: VOTER, p_final: null });
      await t.page.waitForSelector('#lockin');
    });
  });

  test('an organizer can take a stop out (after a confirm)', async () => {
    await withPlan(dinnerDrinks({ is_organizer: true }), async t => {
      await t.page.click('#edittoggle');
      await t.page.click('[data-rmstop="1"]');
      assert.deepEqual(await t.waitCall('remove_poll_stop'), { p_code: CODE, p_creator_key: VOTER, p_part: 1 });
      await t.page.waitForFunction(() => document.querySelectorAll('.night-row').length === 1);
    });
  });
});

describe('times and days', () => {
  test('ticking a stop’s time calls toggle_part_time', async () => {
    await withPlan(dinnerDrinks(), { name: 'Sam' }, async t => {
      await t.page.click('[data-ptime="1|20:00"]');
      assert.deepEqual(await t.waitCall('toggle_part_time'), { p_code: CODE, p_voter_key: VOTER, p_part: 1, p_time: '20:00', p_name: 'Sam' });
      await t.page.waitForSelector('[data-ptime="1|20:00"].on');
      await t.page.click('[data-pmore="0"]');
      await t.page.click('[data-ptime="0|18:30"]');
      assert.deepEqual(await t.waitCall('toggle_part_time', 2), { p_code: CODE, p_voter_key: VOTER, p_part: 0, p_time: '18:30', p_name: 'Sam' });
    });
  });

  test('Which day?: tick a day, or suggest another one', async () => {
    await withPlan(friWithSat(), { name: 'Sam' }, async t => {
      await t.page.click('#step-day [data-time="1"]');
      assert.deepEqual(await t.waitCall('toggle_time'), { p_code: CODE, p_voter_key: VOTER, p_index: 1, p_name: 'Sam' });
    });
    await withPlan(dinnerDrinks(), { name: 'Sam' }, async t => {
      await t.page.click('#daymore');
      await t.page.click(`[data-dayadd="${SAT}"]`);
      assert.deepEqual(await t.waitCall('add_poll_time'), { p_code: CODE, p_voter_key: VOTER, p_day: SAT, p_time: '17:30', p_name: 'Sam', p_planned_day: FRI, p_planned_time: '17:30' });
      await t.page.waitForFunction(() => document.querySelectorAll('#step-day [data-time]').length === 2);
    });
  });

  test('an organizer moves a place to another stop or to a new time', async () => {
    await withPlan(dinnerDrinks({ is_organizer: true }), async t => {
      await t.page.click('#edittoggle');
      await t.page.click('[data-move="1"]');
      await t.page.click('[data-moveto="1|1"]');
      assert.deepEqual(await t.waitCall('move_poll_option'), { p_code: CODE, p_creator_key: VOTER, p_option: 1, p_to_part: 1 });
      await t.page.click('[data-move="1"]');
      await t.page.click('[data-movenew="1|18:30"]');
      assert.deepEqual(await t.waitCall('move_poll_option', 2), { p_code: CODE, p_creator_key: VOTER, p_option: 1, p_time: '18:30', p_date: FRI, p_stop_name: null });
    });
  });
});

describe('more ways to add', () => {
  test('an idea chip fills in the title', async () => {
    await withPlan(dinnerDrinks(), { name: 'Sam' }, async t => {
      await openAdd(t);
      await t.page.fill('#ownplace', 'Liberty Park');
      await t.page.click('[data-ownidea="Picnic"]');
      assert.equal(await t.page.inputValue('#owntitle'), 'Picnic');
      assert.equal(await t.page.inputValue('#ownplace'), 'Liberty Park');
      assert.equal(await count(t, '[data-ownidea="Picnic"].on'), 1);
    });
  });

  test('typing your own stop while the nearby list loads keeps the typing going', async () => {
    const slow = async () => { await new Promise(r => setTimeout(r, 2000)); return [nearRow({ title: 'Lunch special' })]; };
    await withPlan(makePoll({ plan_day: TODAY, parts: [{ name: 'Dinner', time: '19:00' }], options: [opt({ part: 0 })] }), { name: 'Sam', rpc: { deals_near_v3: slow } }, async t => {
      await t.page.click('#fab');
      await t.page.click('#owntitle');
      await t.page.keyboard.type('Bow');
      await t.page.waitForSelector('.pick');
      await t.page.keyboard.type('ling');
      assert.equal(await t.page.inputValue('#owntitle'), 'Bowling');
    });
  });

  test('a park chip adds a walk with its place and map spot', async () => {
    await withPlan(dinnerDrinks(), { name: 'Sam' }, async t => {
      await openAdd(t);
      await t.page.click('[data-park="0"]');
      await t.page.click('#when-ok');
      const b = await t.waitCall('add_poll_stop');
      assert.equal(b.p_title, 'Walk in Liberty Park'); assert.equal(b.p_place, 'Liberty Park, Salt Lake City');
      assert.equal(b.p_lat, 40.7457); assert.equal(b.p_stop_name, 'A walk');
    });
  });

  test('a plain vote: your own idea can join the other options', async () => {
    await withPlan(makePoll({ options: [opt(), opt()] }), { name: 'Sam' }, async t => {
      await openAdd(t);
      await t.page.fill('#owntitle', 'Games at Sam’s');
      await t.page.click('#ownadd');
      await t.page.click('[data-wpart="vote"]');
      assert.equal(await t.text('#when-ok'), 'Add it to the vote');
      await t.page.click('#when-ok');
      assert.deepEqual(await t.waitCall('add_poll_option'), { p_code: CODE, p_voter_key: VOTER, p_name: 'Sam', p_title: 'Games at Sam’s', p_place: null, p_lat: null, p_lng: null });
    });
  });

  test('"＋ Add to Fri" in a plan for each day offers only Friday’s stops to join', async () => {
    await withPlan(eachDay(), { name: 'Sam' }, async t => {
      await t.page.click(`[data-planday="${FRI}"]`);
      await t.page.fill('#owntitle', 'Bowling');
      await t.page.click('#ownadd');
      assert.deepEqual(await texts(t, '[data-wpart]'), ['Fri 6pm · Dinner', 'Fri 8pm · Drinks']);
      assert.equal(await t.text('#when-ok'), 'Suggest it at 8pm');
      await t.page.click('#when-ok');
      const b = await t.waitCall('add_poll_stop');
      assert.equal(b.p_stop_date, FRI); assert.equal(b.p_stop_time, '20:00');
    });
  });

  test('the When sheet does not offer a time that has passed today', async () => {
    const poll = makePoll({ plan_day: TODAY, parts: [{ name: 'Lunch', time: '13:00' }], options: [opt({ part: 0 })] });
    await withPlan(poll, { name: 'Sam', now: '2026-11-26T14:10:00-07:00' }, async t => {
      await openAdd(t);
      await t.page.fill('#owntitle', 'Coffee');
      await t.page.click('#ownadd');
      assert.equal(await t.text('#when-ok'), 'Suggest it at 2:30pm');
      await t.page.click('#when-dn');
      assert.equal(await t.text('#when-ok'), 'Suggest it at 2:30pm');
      await t.page.click('#when-up');
      assert.equal(await t.text('#when-ok'), 'Suggest it at 3pm');
      await t.page.click(`[data-wday="${TODAY}"]`);
      assert.equal(await t.text('#when-ok'), 'Suggest it at 3pm');
    });
  });
});

describe('comments', () => {
  test('a stop’s thread: the place chip prefixes "About <place>: " and keeps what you typed', async () => {
    await withPlan(dinnerDrinks(), { name: 'Sam' }, async t => {
      await t.page.click('[data-thread="0"]');
      await t.page.fill('#note-0', 'Can we sit outside?');
      assert.deepEqual(await texts(t, '[data-about^="0|"]'), ['🕒 5:30pm', 'Zest', 'Nonna']);
      await t.page.click('[data-about="0|1"]');
      assert.equal(await t.page.getAttribute('#note-0', 'placeholder'), 'Say something about Nonna');
      assert.equal(await t.page.inputValue('#note-0'), 'Can we sit outside?');
      await t.page.click('[data-postpart="0"]');
      assert.deepEqual(await t.waitCall('add_poll_comment'), { p_code: CODE, p_voter_key: VOTER, p_name: 'Sam', p_body: 'About Nonna: Can we sit outside?', p_part: 0 });
      await t.page.waitForSelector('.thread .cnote');
      assert.match(await t.text('.thread'), /About Nonna: Can we sit outside\?/);
    });
  });

  test('a comment about the time itself has no prefix', async () => {
    await withPlan(dinnerDrinks(), { name: 'Sam' }, async t => {
      await t.page.click('[data-thread="1"]');
      await t.page.fill('#note-1', 'Can we do 8:30?');
      await t.page.click('[data-postpart="1"]');
      const b = await t.waitCall('add_poll_comment');
      assert.equal(b.p_body, 'Can we do 8:30?'); assert.equal(b.p_part, 1);
    });
  });

  test('deleting your own note asks first', async () => {
    const poll = dinnerDrinks({ comments: [{ id: 7, name: 'Sam', body: 'hi', part: null, at: ago(60e3), mine: true }] });
    await withPlan(poll, { name: 'Sam' }, async t => {
      await t.page.click('[data-del="7"]');
      assert.deepEqual(await t.waitCall('delete_poll_comment'), { p_code: CODE, p_voter_key: VOTER, p_id: 7 });
      assert.equal(t.state.dialogs[0].message, 'Delete your note?');
    });
  });
});

describe('times that have passed today', () => {
  const lateLunch = () => makePoll({ plan_day: TODAY, is_organizer: true, parts: [{ name: 'Lunch', time: '13:00' }, { name: 'Coffee', time: '15:00' }],
    options: [opt({ part: 0, business: 'Deli' }), opt({ part: 1, business: 'Cafe' })] });
  const at210 = '2026-11-26T14:10:00-07:00';
  test('a stop whose time has gone says so', async () => {
    await withPlan(lateLunch(), { now: at210 }, async t => {
      assert.match(await t.text('.night-row'), /⏰ 1pm has already passed today/);
      assert.doesNotMatch((await texts(t, '.night-row'))[1], /already passed/);
    });
  });

  test('other-time chips skip times already gone', async () => {
    await withPlan(lateLunch(), { now: at210 }, async t => {
      await t.page.click('[data-pmore="1"]');
      const chips = await t.page.locator('[data-ptime^="1|"]').evaluateAll(bs => bs.map(b => b.dataset.ptime.split('|')[1]));
      assert.ok(chips.includes('14:30'));
      assert.ok(chips.filter(x => x !== '15:00').every(x => x > '14:10'), chips.join());
    });
  });

  test('move-to-a-new-time chips skip times already gone', async () => {
    await withPlan(lateLunch(), { now: at210 }, async t => {
      await t.page.click('#edittoggle');
      await t.page.click('[data-move="1"]');
      const chips = await t.page.locator('[data-movenew^="1|"]').evaluateAll(bs => bs.map(b => b.dataset.movenew.split('|')[1]));
      assert.equal(chips[0], '14:30');
      assert.ok(chips.every(x => x > '14:10'));
    });
  });

  test('on another day nothing is left out', async () => {
    await withPlan({ ...lateLunch(), plan_day: FRI }, { now: at210 }, async t => {
      await t.page.click('[data-pmore="1"]');
      const chips = await t.page.locator('[data-ptime^="1|"]').evaluateAll(bs => bs.map(b => b.dataset.ptime.split('|')[1]));
      assert.ok(chips.includes('12:00'));
    });
  });

  test('"today" is Salt Lake City’s date even in another time zone', async () => {
    // 8pm Thursday in Utah is already Friday noon in Tokyo.
    await withPlan(dinnerDrinks(), { timezoneId: 'Asia/Tokyo', now: '2026-11-26T20:00:00-07:00' }, async t => {
      assert.equal(await t.raw('.box h2'), '🌃 Your night · Fri, Nov 27');
    });
    await withPlan(dinnerDrinks({ plan_day: TODAY }), { timezoneId: 'Asia/Tokyo', now: '2026-11-26T15:00:00-07:00' }, async t => {
      assert.equal(await t.raw('.box h2'), '🌃 Your night · Tonight');
    });
  });
});

describe('escaping', () => {
  test('names, titles and notes with markup or quotes show as text', async () => {
    const bad = '<img src=x onerror="window.__x=1">';
    const poll = dinnerDrinks({
      title: bad, organizers: ['<i>o</i>'],
      options: [opt({ title: `Tom's "Best" <b>Tacos</b>`, business: '<script>window.__x=2</script>', part: 0, added_by: bad }), opt({ part: 0, business: 'B' }), opt({ part: 1, business: `"><svg onload=window.__x=3>` })],
      voters: [{ name: '<script>window.__x=4</script>', option: 0 }], counts: [1, 0, 0], voter_count: 1,
      rsvp: { in: [bad], maybe: [], out: [] },
      comments: [{ id: 1, name: bad, body: `"><img src=x onerror=window.__x=5>`, part: null, at: ago(60e3), mine: false }, { id: 2, name: 'x', body: '<u>u</u>', part: 0, at: ago(60e3), mine: false }],
      activity: [{ line: '<svg onload=window.__x=6>', at: ago(60e3) }],
      part_times: [{ part: 0, time: '18:00', n: 1, names: [bad], mine: false, added_by: bad }],
      tickets: [], times: [{ day: FRI, time: '17:30', planned: true, added_by: bad }], time_voters: [{ name: bad, time: 0 }], time_counts: [1],
    });
    await withPlan(poll, async t => {
      await t.page.waitForTimeout(200);
      assert.equal(await t.page.evaluate(() => window.__x), undefined);
      assert.equal(await count(t, '#app img, #app svg, #app script, #app u, #app i'), 0);
      assert.equal(await t.text('h1'), bad);
      assert.match(await t.text('#app'), /Tom's "Best" <b>Tacos<\/b>/);
      assert.match(await t.text('#app'), /"><img src=x onerror=window.__x=5>/);
      assert.match(await t.text('.thread'), /<u>u<\/u>/);
      // The sheets build their own markup too.
      await openAdd(t);
      await t.page.fill('#owntitle', '<img src=x onerror=window.__x=7>');
      await t.page.click('#ownadd');
      await t.page.click('#askname-skip');
      assert.equal(await t.text('#when-t'), 'When for <img src=x onerror=window.__x=7>?');
      assert.equal(await count(t, '.askname img'), 0);
      assert.equal(await t.page.evaluate(() => window.__x), undefined);
    });
  });
});
