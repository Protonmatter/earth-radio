// Sign in remains the existing account owner, reached through Library on every
// viewport. Provider, storage failure, sync and focus assertions stay intact.

import { expect, test } from '@playwright/test';
import { setupApp,openAccountView } from './helpers.mjs';

test('desktop Sign in is reachable in Library Account', async ({ page }) => {
  await setupApp(page, { enableAuth: true });
  await openAccountView(page);
  const signIn = page.locator('#er-auth-button');
  await expect(signIn).toBeVisible();
  await expect(signIn).toHaveText('Sign in');
  await expect(page.locator('#er-library-account-actions > button').first()).toHaveId('er-auth-button');

  const box = await signIn.boundingBox();
  assertVisibleInViewport(box,page.viewportSize());

  await signIn.click();
  await expect(page.locator('.er-auth-modal')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
});

test('narrow viewports keep Sign in reachable through Library Account', async ({ page }) => {
  await setupApp(page, { enableAuth: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('html')).toHaveClass(/er-mobile/);
  const signIn=await openAccountView(page);
  await expect(signIn).toHaveText('Sign in');assertVisibleInViewport(await signIn.boundingBox(),page.viewportSize());
  await signIn.click();
  await expect(page.locator('#er-overflow')).toBeHidden();
  await expect(page.locator('.er-auth-modal')).toBeVisible();
  await expect.poll(async () => page.evaluate(() => (
    Boolean(document.activeElement?.closest('.er-auth-modal'))
  ))).toBe(true);
});

test('account dialog keeps keyboard focus inside and restores the opening control', async ({ page }) => {
  await setupApp(page, { enableAuth: true });
  await openAccountView(page);
  await page.locator('#er-auth-button').click();
  const dialog = page.getByRole('dialog', { name: 'Sign in to Earth Radio' });
  const close = dialog.getByRole('button', { name: 'Close account dialog' });
  const submit = dialog.getByRole('button', { name: 'Email me a sign-in link' });
  await expect(dialog.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await close.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(submit).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('#er-auth-button')).toBeFocused();
});

test('mobile account dialog returns keyboard focus to its visible opening control', async ({ page }) => {
  await setupApp(page, { enableAuth: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('html')).toHaveClass(/er-mobile/);
  const signIn=await openAccountView(page);await signIn.click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.er-auth-modal')).toBeHidden();
  await expect(signIn).toBeFocused();
});

test('provider discovery preserves the focused account control while repainting', async ({ page }) => {
  await setupApp(page, { enableAuth: true });
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  await page.route('**/auth/v1/settings', async route => {
    await ready;
    await route.fulfill({ json: { external: { github: true, google: true } } });
  });
  await page.reload();
  await openAccountView(page);
  await page.locator('#er-auth-button').click();
  const dialog = page.getByRole('dialog', { name: 'Sign in to Earth Radio' });
  const close = dialog.getByRole('button', { name: 'Close account dialog' });
  await expect(close).toBeFocused();
  release();
  await expect(dialog.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(close).toBeFocused();
});

test('browser storage failure pauses sign-out safely and lets the user retry', async ({ page }) => {
  await setupApp(page, { enableAuth: true });
  const user = { id: 'browser-storage-user', email: 'storage@earth-radio.test', identities: [{ provider: 'google' }] };
  // Keep the real client, IndexedDB namespace and UI; replace only hosted HTTP.
  await page.route('https://*.supabase.co/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/settings')) return route.fulfill({ json: { external: { google: true, github: true } } });
    if (path.endsWith('/user')) return route.fulfill({ json: user });
    if (path.endsWith('/logout')) return route.fulfill({ status: 204 });
    if (path.endsWith('/user_config_documents')) return route.fulfill({ json: [] });
    if (path.endsWith('/rpc/upsert_user_config_document')) {
      const body = route.request().postDataJSON();
      return route.fulfill({ json: [{ document_key: body.p_document_key, value: body.p_value, revision: 1, deleted_at: null }] });
    }
    return route.abort();
  });
  await page.evaluate(user => localStorage.setItem('earthRadio.auth.session.v1', JSON.stringify({
    user, access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_at: 4102444800
  })), user);
  await page.reload();
  await openAccountView(page);
  const account = page.locator('#er-auth-button');
  await expect(account).toHaveText(user.email);
  await account.click();
  const dialog = page.getByRole('dialog', { name: 'Your Earth Radio account' });
  await expect(dialog.locator('.er-auth-sync')).toHaveText('Synced');
  await page.evaluate(() => {
    window.qualificationUnhandled = 0;
    window.addEventListener('unhandledrejection', () => { window.qualificationUnhandled++; });
    window.qualificationRemoveItem = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (key) {
      if (key === 'earthRadio.auth.session.v1') throw new Error('Fixture: browser storage access denied');
      return window.qualificationRemoveItem.call(this, key);
    };
  });
  await dialog.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(dialog.locator('.er-auth-sync')).toHaveText('Sign-out incomplete · sync paused');
  await expect(dialog.getByRole('button', { name: 'Sync now' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Link GitHub' })).toBeDisabled();
  expect(await page.evaluate(() => window.qualificationUnhandled)).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('earthRadio.auth.activeUser.v1'))).toBe(user.id);
  expect(await page.evaluate(() => localStorage.getItem('earthRadio.auth.session.v1') !== null)).toBe(true);
  await page.evaluate(() => { Storage.prototype.removeItem = window.qualificationRemoveItem; });
  await Promise.all([
    page.waitForEvent('domcontentloaded'),
    dialog.getByRole('button', { name: 'Sign out', exact: true }).click()
  ]);
  await openAccountView(page);
  await expect(account).toHaveText('Sign in');
  expect(await page.evaluate(() => localStorage.getItem('earthRadio.auth.session.v1'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('earthRadio.auth.activeUser.v1'))).toBeNull();
});

function assertVisibleInViewport(box,viewport) {
  if (!box) throw new Error('Sign in has no layout box');
  expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(viewport.height);
  expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);
}
