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

function assertVisibleInRail(box) {
  if (!box) throw new Error('Sign in has no layout box');
  if (box.x > 16 || box.width < 180) {
    throw new Error(`Sign in is not in the left rail: x=${box.x} width=${box.width}`);
  }
  if (box.y < 40 || box.height < 24) {
    throw new Error(`Sign in is not visible in the rail: y=${box.y} height=${box.height}`);
  }
}
