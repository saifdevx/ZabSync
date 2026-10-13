import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../server/app.js';
import { makeTestConfig } from '../server/config.js';
import { openDatabase } from '../server/db.js';
import { DEMO_USERS } from '../server/demo.js';
import { getSettings } from '../server/site-settings.js';
import { renderApplication } from './ui-harness.js';

function responseGate() {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  return { entered, release };
}

test(
  'rendered feature controls wait for confirmed settings and retain disabled features and page state during a bookmark refresh',
  { timeout: 180_000 },
  async (t) => {
    const db = await openDatabase('file::memory:');
    const app = await createApp({ db, config: makeTestConfig(), seedDemo: true });
    app.addHook('onClose', async () => db.close());
    const initial = responseGate();
    const refreshing = responseGate();
    const startedRequests: Array<{ method: string; url: string }> = [];
    let nextSiteResponse: ReturnType<typeof responseGate> | null = initial;
    app.addHook('onRequest', async (request) => {
      startedRequests.push({ method: request.method, url: request.url });
    });
    // Delay real responses without replacing any API result. This makes both
    // loading windows observable instead of relying on local request timing.
    app.addHook('onSend', async (request, _reply, payload) => {
      if (request.url === '/api/site' && nextSiteResponse) {
        const held = nextSiteResponse;
        nextSiteResponse = null;
        held.entered.resolve();
        await held.release.promise;
      }
      return payload;
    });
    t.after(() => {
      initial.release.resolve();
      refreshing.release.resolve();
    });
    await app.ready();
    const settings = await getSettings(db);
    await db.execute({
      sql: 'UPDATE site_settings SET features_json=? WHERE id=1',
      args: [
        JSON.stringify({
          ...settings.features,
          subjects: false,
          resources: false,
          timetable: false,
          profilePhotos: false,
        }),
      ],
    });
    await db.execute({
      sql: 'UPDATE users SET avatar_version=? WHERE id=?',
      args: ['photo-present-before-feature-paused', DEMO_USERS.student.id],
    });
    const ui = await renderApplication(t, { app });
    const { screen, fireEvent, waitFor, within, mainNavigation, calls, dom } = ui;
    const noDisabledFeatureRequests = () =>
      assert.deepEqual(
        startedRequests.filter(
          (call) =>
            /^\/api\/(?:classes\/[^/]+\/)?(?:subjects|resources|timetable|schedule-exceptions)(?:[/?]|$)/.test(
              call.url,
            ) || /\/avatar(?:[/?]|$)/.test(call.url),
        ),
        [],
        'Disabled features must never issue a request, including during settings refreshes.',
      );
    const noEnabledFeatureLinks = () =>
      assert.ok(
        dom.window.document.querySelector(
          'a[href^="/timetable"], a[href^="/subjects"], a[href^="/resources"]',
        ) === null,
        'Disabled feature links must not appear before or between confirmed settings.',
      );

    fireEvent.click(await screen.findByRole('button', { name: /^Student/ }));
    await waitFor(() => initial.entered.promise);
    await screen.findByText('Loading your campus settings…');
    assert.ok(
      screen.queryByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening),/ }) ===
        null,
      'The dashboard waits for the initial confirmed settings.',
    );
    noEnabledFeatureLinks();
    noDisabledFeatureRequests();
    initial.release.resolve();
    await screen.findByRole('heading', {
      level: 1,
      name: /^Good (morning|afternoon|evening), Areeba\.$/,
    });
    await screen.findByRole('heading', { name: 'Your class, in one place' });
    assert.equal(
      ui.lastCall('GET', '/api/me')?.response?.user.avatarVersion,
      'photo-present-before-feature-paused',
      'The fixture keeps the stored photo version, so the client must apply the disabled flag.',
    );
    noEnabledFeatureLinks();
    noDisabledFeatureRequests();
    assert.ok(
      screen.queryByRole('button', {
        name: /Add subject|Join a subject|Upload file|Weekly class/,
      }) === null,
    );

    fireEvent.click(mainNavigation().getByRole('link', { name: 'Noticeboard' }));
    await screen.findByRole('heading', { level: 1, name: 'Your noticeboard' });
    const search = screen.getByPlaceholderText('Search announcements') as HTMLInputElement;
    const audience = screen.getByLabelText('Filter announcement audience') as HTMLSelectElement;
    fireEvent.change(search, { target: { value: 'Your class' } });
    fireEvent.change(audience, { target: { value: 'class' } });
    await waitFor(() =>
      assert.ok(
        calls.some(
          (call) =>
            call.method === 'GET' &&
            call.url.startsWith('/api/announcements?') &&
            call.url.includes('q=Your+class') &&
            call.url.includes('scope=class') &&
            call.status === 200,
        ),
      ),
    );
    const notice = (
      await screen.findByRole('heading', { name: 'Your class, in one place' })
    ).closest('article');
    assert.ok(notice);
    const siteReads = calls.filter((call) => call.url === '/api/site').length;
    nextSiteResponse = refreshing;
    fireEvent.click(within(notice).getByRole('button', { name: 'Save announcement' }));
    await waitFor(() => refreshing.entered.promise);
    // The content event refreshes /site too. A loading/null settings state must
    // neither enable a feature nor unmount the page and erase its filters.
    assert.ok(screen.getByRole('heading', { level: 1, name: 'Your noticeboard' }));
    assert.ok(screen.getByPlaceholderText('Search announcements') === search);
    assert.equal(search.value, 'Your class');
    assert.equal(audience.value, 'class');
    noEnabledFeatureLinks();
    noDisabledFeatureRequests();
    refreshing.release.resolve();
    await waitFor(() =>
      assert.equal(calls.filter((call) => call.url === '/api/site').length, siteReads + 1),
    );
    await screen.findByRole('button', { name: 'Unsave announcement' });
    assert.ok(screen.getByPlaceholderText('Search announcements') === search);
    assert.equal(search.value, 'Your class');
    assert.equal(audience.value, 'class');
    assert.ok(
      calls.some(
        (call) =>
          call.method === 'POST' &&
          call.url.startsWith('/api/bookmarks/announcement/') &&
          call.response?.saved === true,
      ),
    );
    noEnabledFeatureLinks();
    noDisabledFeatureRequests();

    fireEvent.click(mainNavigation().getByRole('link', { name: /^My Class/ }));
    await screen.findByRole('heading', { level: 1, name: '5D' });
    const tabs = within(screen.getByRole('group', { name: 'Class sections' }));
    for (const name of ['Subjects', 'Resources', 'Timetable'])
      assert.ok(tabs.queryByRole('button', { name }) === null);
    fireEvent.click(tabs.getByRole('button', { name: /^People/ }));
    await screen.findByRole('heading', { name: 'Your class community' });
    const people = dom.window.document.querySelector('.people-list');
    assert.ok(people);
    assert.ok(within(people as HTMLElement).getByText('Areeba Khan'));
    noDisabledFeatureRequests();

    fireEvent.click(screen.getByRole('link', { name: 'Open your account' }));
    await screen.findByRole('heading', { level: 1, name: 'Make yourself at home' });
    await screen.findByText('Profile photos are currently turned off by the administrator.');
    assert.ok(screen.queryByLabelText('Choose a profile photo') === null);
    assert.ok(
      screen.queryByRole('button', { name: /Choose a (new )?photo|Remove photo/ }) === null,
    );
    noDisabledFeatureRequests();
    ui.assertNoApiErrors();
  },
);
