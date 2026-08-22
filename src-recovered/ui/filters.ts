// Filter sidebar with stable-ID state that persists across open/close and import.
// See SPEC-FILTERS-001.
import { BITRATE_BUCKETS, getBitrateBucketId, getBitrateBucketLabel, parseTags } from '../domains/radio/normalize';
import type { Station } from '../core/types';
import { t } from '../core/i18n';
import { byId } from './dom';

export interface ActiveFilters {
  countries: string[];
  tags: string[];
  bitrates: string[];
  secureOnly: boolean;
  minQuality: number;
}

type ChangeCallback = (filters: ActiveFilters) => void;

let onChangeCallback: ChangeCallback | null = null;
let activeCountries = new Set<string>();
let activeTags = new Set<string>();
let activeBitrates = new Set<string>();
let activeSecureOnly = false;
let activeMinQuality = 0;

let filterSidebar: HTMLElement | null = null;
let filterCountries: HTMLElement | null = null;
let filterTags: HTMLElement | null = null;
let filterBitrates: HTMLElement | null = null;
let filterQuality: HTMLInputElement | null = null;
let filterSecureOnly: HTMLInputElement | null = null;
let filterSummary: HTMLElement | null = null;
let boundOutsideClick: ((event: MouseEvent) => void) | null = null;

export function initFilters(stations: Station[], onChange: ChangeCallback, initialState: Partial<ActiveFilters> = {}): void {
  filterSidebar = byId('filter-sidebar');
  filterCountries = byId('filter-countries');
  filterTags = byId('filter-tags');
  filterBitrates = byId('filter-bitrates');
  filterQuality = byId<HTMLInputElement>('filter-quality');
  filterSecureOnly = byId<HTMLInputElement>('filter-secure-only');
  filterSummary = byId('filter-summary');

  if (!filterSidebar) {
    console.warn('Filters: #filter-sidebar not found');
    return;
  }

  onChangeCallback = onChange;
  setFilterState(initialState, { emit: false, syncControls: false });
  renderFilters(stations);
  bindDelegates();
  syncFilterControls();
  updateFilterSummary();
}

export function openFilters(): void {
  if (!filterSidebar) return;
  filterSidebar.classList.add('filter-sidebar--open');
  filterSidebar.setAttribute('aria-hidden', 'false');
  document.querySelector('[data-open-filters]')?.setAttribute('aria-expanded', 'true');
  filterSidebar.querySelector<HTMLElement>('input, button')?.focus({ preventScroll: true });
}

export function closeFilters(): void {
  if (!filterSidebar) return;
  filterSidebar.classList.remove('filter-sidebar--open');
  filterSidebar.setAttribute('aria-hidden', 'true');
  document.querySelector('[data-open-filters]')?.setAttribute('aria-expanded', 'false');
}

export function resetFilters(): void {
  setFilterState({ countries: [], tags: [], bitrates: [], secureOnly: false, minQuality: 0 });
}

export function setFilterState(nextState: Partial<ActiveFilters> = {}, options: { emit?: boolean; syncControls?: boolean } = {}): void {
  const { emit = true, syncControls = true } = options;

  if (Array.isArray(nextState.countries)) activeCountries = new Set(nextState.countries);
  if (Array.isArray(nextState.tags)) activeTags = new Set(nextState.tags);
  if (Array.isArray(nextState.bitrates)) activeBitrates = new Set(nextState.bitrates);
  if ('secureOnly' in nextState) activeSecureOnly = Boolean(nextState.secureOnly);
  if ('minQuality' in nextState) activeMinQuality = normalizeQuality(nextState.minQuality);

  if (syncControls) syncFilterControls();
  if (emit) emitChange();
  else updateFilterSummary();
}

export function getActiveFilters(): ActiveFilters {
  return {
    countries: [...activeCountries],
    tags: [...activeTags],
    bitrates: [...activeBitrates],
    secureOnly: activeSecureOnly,
    minQuality: activeMinQuality
  };
}

export function updateFilterOptions(stations: Station[]): void {
  const previous = getActiveFilters();
  renderFilters(stations);
  restoreCheckboxState(filterCountries, new Set(previous.countries));
  restoreCheckboxState(filterTags, new Set(previous.tags));
  restoreCheckboxState(filterBitrates, new Set(previous.bitrates));
  activeCountries = collectCheckedValues(filterCountries);
  activeTags = collectCheckedValues(filterTags);
  activeBitrates = collectCheckedValues(filterBitrates);
  if (filterSecureOnly) filterSecureOnly.checked = previous.secureOnly;
  if (filterQuality) filterQuality.value = String(previous.minQuality);
  activeSecureOnly = previous.secureOnly;
  activeMinQuality = previous.minQuality;
  updateFilterSummary();
}

function bindDelegates(): void {
  for (const container of [filterCountries, filterTags, filterBitrates]) {
    container?.addEventListener('change', onFilterChange);
  }

  filterSecureOnly?.addEventListener('change', event => {
    activeSecureOnly = Boolean((event.target as HTMLInputElement).checked);
    emitChange();
  });

  filterQuality?.addEventListener('input', event => {
    activeMinQuality = normalizeQuality((event.target as HTMLInputElement).value);
    emitChange();
  });

  filterSidebar?.querySelector('[data-close-filters]')?.addEventListener('click', closeFilters);
  filterSidebar?.querySelector('[data-reset-filters]')?.addEventListener('click', resetFilters);

  if (!boundOutsideClick) {
    boundOutsideClick = event => {
      if (!filterSidebar?.classList.contains('filter-sidebar--open')) return;
      const target = event.target as Node;
      if (!filterSidebar.contains(target) && !(target as HTMLElement).closest?.('[data-open-filters]')) closeFilters();
    };
    document.addEventListener('click', boundOutsideClick);
  }
}

function renderFilters(stations: Station[]): void {
  const countryCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();
  const bitrateCounts = new Map<string, number>(BITRATE_BUCKETS.map(bucket => [bucket.id, 0]));

  for (const station of stations || []) {
    const country = station.country || 'Unknown';
    countryCounts.set(country, (countryCounts.get(country) || 0) + 1);

    for (const tag of station.tagList || parseTags(station.tags)) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }

    const bucketId = getBitrateBucketId(station.bitrate);
    bitrateCounts.set(bucketId, (bitrateCounts.get(bucketId) || 0) + 1);
  }

  renderCheckboxList(filterCountries, countryCounts, 'country', activeCountries, 32);
  renderCheckboxList(filterTags, tagCounts, 'tag', activeTags, 32);
  renderCheckboxList(filterBitrates, bitrateCounts, 'bitrate', activeBitrates, null, sortBitrateBuckets, getBitrateBucketLabel);
}

function renderCheckboxList(
  container: HTMLElement | null,
  counts: Map<string, number>,
  inputName: string,
  activeSet: Set<string>,
  limit: number | null = 30,
  sortFn?: (a: [string, number], b: [string, number]) => number,
  labelFn: (value: string) => string = value => value
): void {
  if (!container) return;
  const entries = [...counts.entries()].filter(([, count]) => count > 0);
  entries.sort(sortFn || ((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));
  const visibleEntries = limit ? entries.slice(0, limit) : entries;

  container.innerHTML = '';

  for (const [value, count] of visibleEntries) {
    const item = document.createElement('label');
    item.className = 'filter-item';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = value;
    input.name = inputName;
    input.checked = activeSet.has(value);

    const label = document.createElement('span');
    label.textContent = labelFn(value);

    const countEl = document.createElement('span');
    countEl.className = 'filter-count';
    countEl.textContent = `(${count})`;

    item.append(input, label, countEl);
    container.appendChild(item);
  }

  if (visibleEntries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'filter-empty';
    empty.textContent = t('filters.empty');
    container.appendChild(empty);
  }
}

function onFilterChange(event: Event): void {
  const checkbox = event.target as HTMLInputElement;
  if (!(checkbox instanceof HTMLInputElement) || checkbox.type !== 'checkbox') return;

  const value = checkbox.value;
  if (checkbox.name === 'country') toggleSet(activeCountries, value, checkbox.checked);
  if (checkbox.name === 'tag') toggleSet(activeTags, value, checkbox.checked);
  if (checkbox.name === 'bitrate') toggleSet(activeBitrates, value, checkbox.checked);

  emitChange();
}

function emitChange(): void {
  updateFilterSummary();
  onChangeCallback?.(getActiveFilters());
}

function syncFilterControls(): void {
  restoreCheckboxState(filterCountries, activeCountries);
  restoreCheckboxState(filterTags, activeTags);
  restoreCheckboxState(filterBitrates, activeBitrates);
  if (filterSecureOnly) filterSecureOnly.checked = activeSecureOnly;
  if (filterQuality) filterQuality.value = String(activeMinQuality);
}

function updateFilterSummary(): void {
  if (!filterSummary) return;
  const activeCount = activeCountries.size + activeTags.size + activeBitrates.size + (activeSecureOnly ? 1 : 0) + (activeMinQuality > 0 ? 1 : 0);
  filterSummary.textContent =
    activeCount === 0 ? t('filters.none') : activeCount === 1 ? t('filters.activeOne') : t('filters.active', { count: activeCount });
}

function toggleSet(set: Set<string>, value: string, checked: boolean): void {
  if (checked) set.add(value);
  else set.delete(value);
}

function collectCheckedValues(container: HTMLElement | null): Set<string> {
  if (!container) return new Set();
  return new Set([...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')].map(input => input.value));
}

function restoreCheckboxState(container: HTMLElement | null, previous: Set<string>): void {
  if (!container) return;
  container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(input => {
    input.checked = previous.has(input.value);
  });
}

function normalizeQuality(value: unknown): number {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(90, Math.round(parsed / 10) * 10));
}

function sortBitrateBuckets(a: [string, number], b: [string, number]): number {
  const order = BITRATE_BUCKETS.map(bucket => bucket.id);
  return order.indexOf(a[0]) - order.indexOf(b[0]);
}
