// Sign in must be a first-class control: the desktop rail, not the clipped
// search strip, and the mobile overflow sheet.

import { expect, test } from '@playwright/test';
import { setupApp } from './helpers.mjs';

test('desktop Sign in sits at the top of the left rail', async ({ page }) => {
  await setupApp(page, { enableAuth: true });
  const signIn = page.locator('#er-auth-button');
  await expect(signIn).toBeVisible();
  await expect(signIn).toHaveText('Sign in');
  await expect(page.locator('.header-right > button').first()).toHaveId('er-auth-button');

  const box = await signIn.boundingBox();
  assertVisibleInRail(box);

  await signIn.click();
  await expect(page.locator('.er-auth-modal')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
});

test('narrow viewports keep Sign in in the overflow sheet', async ({ page }) => {
  await setupApp(page, { enableAuth: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('html')).toHaveClass(/er-mobile/);
  await expect(page.locator('#er-auth-button')).toBeHidden();
  await expect(page.locator('#er-overflow-toggle')).toBeVisible();

  await page.locator('#er-overflow-toggle').click();
  const overflowSignIn = page.locator('#er-overflow .er-auth-overflow');
  await expect(overflowSignIn).toBeVisible();
  await expect(overflowSignIn).toHaveText('Sign in');
  await overflowSignIn.click();
  await expect(page.locator('#er-overflow')).toBeHidden();
  await expect(page.locator('.er-auth-modal')).toBeVisible();
  await expect.poll(async () => page.evaluate(() => (
    Boolean(document.activeElement?.closest('.er-auth-modal'))
  ))).toBe(true);
});

test('account dialog keeps keyboard focus inside and restores the opening control', async ({ page }) => {
  await setupApp(page, { enableAuth: true });
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

test('mobile account dialog returns keyboard focus to the overflow trigger', async ({ page }) => {
  await setupApp(page, { enableAuth: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('html')).toHaveClass(/er-mobile/);
  const overflow = page.locator('#er-overflow-toggle');
  await overflow.click();
  await page.locator('#er-overflow .er-auth-overflow').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.er-auth-modal')).toBeHidden();
  await expect(overflow).toBeFocused();
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
  await expect(account).toHaveText('Sign in');
  expect(await page.evaluate(() => localStorage.getItem('earthRadio.auth.session.v1'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('earthRadio.auth.activeUser.v1'))).toBeNull();
});

function assertVisibleInRail(box) {
  if (!box) throw new Error('Sign in has no layout box');
  if (box.x > 16 || box.width < 180) {
    throw new Error(`Sign in is not in the left rail: x=${box.x} width=${box.width}`);
  }
  if (box.y < 40 || box.height < 24) {
    throw new Error(`Sign in is not visible in the rail: y=${box.y} height=${box.height}`);
  }
}
