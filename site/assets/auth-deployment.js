// Intentionally public deployment data. Authorization is enforced by Supabase RLS.
export const WEB_APP_ORIGINS = Object.freeze([
  'https://app.earthradio.stream',
  'https://earth-radio.pages.dev'
]);
export const isWebAuthOrigin = origin => typeof origin === 'string' && WEB_APP_ORIGINS.includes(origin);

export const AUTH_DEPLOYMENT = Object.freeze({
  "url": "https://ueomkorngpgvthqioqns.supabase.co",
  "publishableKey": "sb_publishable_5oaWYxR0LVs4UHplfnaP6g_ArQQSBa0"
});
