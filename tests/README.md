# Plan page tests

Automated tests for the shared plan page (`vote.html`): what friends see and
what the page sends when they vote, answer, add places and lock it in.

## Run

From the repo root:

```
node --test tests/
```

(`node --test tests/plan-page.test.mjs` runs the same file.) It takes about a
minute.

## What it needs

- Node 20 or later.
- Playwright with its Chromium browser (`require('playwright')` must work, and
  `npx playwright install chromium` if the browser isn't there yet). Nothing to
  install in this repo.

## How it works

- `vote.html` is opened straight from disk with `?p=test123`.
- It never calls the real API. Every request is answered by a fake database in
  `helpers.mjs` (`get_poll`, `toggle_vote`, `add_poll_stop`, `lock_poll`, the
  deals lookup, and so on); anything else, like the weather, is blocked.
- The clock is fixed to noon on Thu, Nov 26 2026 in Salt Lake City, so plans
  are for Fri 11-27 and Sat 11-28. Tests about times that have passed set
  their own time.
- Tests check both what's on the page and the exact calls it made
  (`t.calls('toggle_vote')`, `t.writes()`).

To add a test: build a plan with `makePoll()` / `dinnerDrinks()`, open it with
`openPlan(poll, { name, nearby, rpc, now })`, click, and assert.
