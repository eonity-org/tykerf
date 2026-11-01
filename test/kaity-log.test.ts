// Kaity's work across a site (src/editor/kaity-log.ts): every run on any page, or on the whole site, in one log.

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AI, type RunEvents, type RunRequest, type Runner, SITE_CHAT } from '../src/editor/ai.js';
import { kaityRuns, logEnd, logStart } from '../src/editor/kaity-log.js';
import { newSitePage, siteLink } from '../src/site.js';
import { Workspace } from '../src/workspace.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'tykerf-kaity-log-'));

/** A runner that waits to be told how the run goes. */
function fakeRunner() {
  const runs: { req: RunRequest; on: RunEvents }[] = [];
  const runner: Runner = { start: (req, on) => (runs.push({ req, on }), { cancel: () => (on.error('stopped'), on.end()) }) };
  return { runner, runs };
}

describe("Kaity's log", () => {
  it('pairs each start with its end, newest first; a run with no end is going on, or was cut short', () => {
    const site = tmp();
    logStart(site, { run: 'a', page: 'home', block: 'hero', request: 'Bigger title' });
    logEnd(site, { run: 'a', end: 'done', block: 'welcome', answer: 'Done: the title is bigger.', steps: 3 });
    logStart(site, { run: 'b', page: null, block: null, request: 'Link every page' });
    logStart(site, { run: 'c', page: 'about', block: 'team', request: 'Add Ana' });
    const runs = kaityRuns(site, new Map([['b', { step: 'open page about', steps: 2 }]]));
    expect(runs.map((r) => [r.run, r.state])).toEqual([['c', 'cut short'], ['b', 'working'], ['a', 'done']]);
    expect(runs[1]).toMatchObject({ page: null, step: 'open page about', steps: 2 });
    expect(runs[2]).toMatchObject({ block: 'welcome', answer: 'Done: the title is bigger.', steps: 3 }); // the block's name at the end
  });

  it('keeps the newest runs when it grows long', () => {
    const site = tmp();
    for (let i = 0; i < 2001; i++) logStart(site, { run: `r${i}`, page: 'home', block: 'hero', request: 'x' });
    const lines = readFileSync(join(site, '.tykerf', 'kaity.jsonl'), 'utf8').trim().split('\n');
    expect(lines.length).toBeLessThanOrEqual(1001); // past 2000 lines, the newest 1000 stay
    expect(JSON.parse(lines.at(-1)!).run).toBe('r2000');
    expect(kaityRuns(site, new Map(), 5).map((r) => r.run)).toEqual(['r2000', 'r1999', 'r1998', 'r1997', 'r1996']);
  });

  it("records a page's runs and the site's at the site: what was asked, how it ended, her answer", () => {
    const site = tmp();
    const home = newSitePage(site, 'home', 'launch');
    const { runner, runs } = fakeRunner();
    const page = new AI(home, () => {}, runner);
    page.ask('hero', 'Make the title bigger');
    expect(kaityRuns(site, new Map([[page.progress()!.run, page.progress()!]]))[0]).toMatchObject({ page: 'home', block: 'hero', request: 'Make the title bigger', state: 'working' });
    runs[0].on.step('edit content hero');
    expect(page.progress()).toMatchObject({ block: 'hero', step: 'edit content hero', steps: 1 });
    runs[0].on.answer('The title is bigger now.');
    runs[0].on.end();
    expect(page.progress()).toBeNull();
    expect(kaityRuns(site)[0]).toMatchObject({ page: 'home', block: 'hero', state: 'done', answer: 'The title is bigger now.', steps: 1 });

    // stopped, then a run on the whole site
    page.ask('hero', 'Try again');
    page.cancel();
    const whole = new AI(new Workspace(site, { site: siteLink(site) }), () => {}, runner, { site });
    whole.ask(SITE_CHAT, 'Link every page');
    runs[2].on.error('the model is busy');
    runs[2].on.end();
    expect(kaityRuns(site).map((r) => [r.page, r.request, r.state, r.error ?? null])).toEqual([
      [null, 'Link every page', 'failed', 'the model is busy'],
      ['home', 'Try again', 'stopped', 'stopped'],
      ['home', 'Make the title bigger', 'done', null],
    ]);
  });
});
