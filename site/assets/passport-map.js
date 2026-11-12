// Ephemeral view state only. This module never loads geometry or reads storage.
let countries = [];
const listeners = new Set();
export const passportMapCountries = () => [...countries];
export function setPassportMapCountries(values) {
  const next = [...new Set((Array.isArray(values) ? values : []).filter(code => typeof code === 'string' && /^[A-Z]{2}$/.test(code)))].sort().slice(0, 300);
  if (JSON.stringify(next) === JSON.stringify(countries)) return;
  countries = next;
  for (const listener of listeners) { try { listener([...countries]); } catch { console.warn('Earth Radio Passport map could not refresh.'); } }
}
export function subscribePassportMap(listener) { listeners.add(listener); return () => listeners.delete(listener); }
