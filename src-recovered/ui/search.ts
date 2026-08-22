// Command-palette search modal with focus trap and keyboard navigation. See SPEC-SEARCH-001.
import type { Station } from '../core/types';
import { t } from '../core/i18n';
import { byId, countryCodeToFlag } from './dom';

type SelectCallback = (station: Station) => void;

let searchModal: HTMLElement | null = null;
let searchInput: HTMLInputElement | null = null;
let searchResults: HTMLElement | null = null;
let allStations: Station[] = [];
let filteredStations: Station[] = [];
let selectedIndex = -1;
let onSelectCallback: SelectCallback | null = null;
let lastFocusedElement: HTMLElement | null = null;

export function initSearch(stations: Station[], onSelect: SelectCallback): void {
  searchModal = byId('search-modal');
  searchInput = byId<HTMLInputElement>('search-input');
  searchResults = byId('search-results');

  if (!searchModal || !searchInput || !searchResults) {
    console.warn('Search: required DOM elements not found');
    return;
  }

  onSelectCallback = onSelect;
  allStations = stations || [];
  filteredStations = [];
  selectedIndex = -1;
  searchInput.placeholder = t('search.placeholder');

  searchInput.addEventListener('input', handleInput);
  searchInput.addEventListener('keydown', onKeydown);
  searchResults.addEventListener('click', onResultClick);
  searchModal.querySelector('.search-backdrop')?.addEventListener('click', closeSearch);
}

export function openSearch(): void {
  if (!searchModal || !searchInput) return;
  lastFocusedElement = document.activeElement as HTMLElement;
  searchModal.hidden = false;
  searchModal.style.display = 'flex';
  searchModal.setAttribute('aria-hidden', 'false');
  searchInput.value = '';
  selectedIndex = -1;
  filteredStations = allStations.slice(0, 50);
  renderResults();
  requestAnimationFrame(() => searchInput?.focus());
}

export function closeSearch(): void {
  if (!searchModal) return;
  searchModal.hidden = true;
  searchModal.style.display = 'none';
  searchModal.setAttribute('aria-hidden', 'true');
  if (searchInput) searchInput.value = '';
  selectedIndex = -1;
  if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
    lastFocusedElement.focus({ preventScroll: true });
  }
}

export function updateSearchStations(stations: Station[]): void {
  allStations = stations || [];
  if (searchModal && !searchModal.hidden) handleInput();
}

function handleInput(): void {
  if (!searchInput) return;
  const query = searchInput.value.trim().toLowerCase();
  filteredStations = !query ? allStations.slice(0, 50) : allStations.filter(station => stationMatches(station, query)).slice(0, 50);
  selectedIndex = filteredStations.length ? 0 : -1;
  renderResults();
}

function renderResults(): void {
  if (!searchResults || !searchInput) return;
  searchResults.innerHTML = '';
  const query = searchInput.value.trim().toLowerCase();

  filteredStations.forEach((station, index) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'search-result-item';
    item.dataset.index = String(index);
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(index === selectedIndex));
    if (index === selectedIndex) item.classList.add('search-result-item--active');

    const flag = document.createElement('span');
    flag.className = 'search-result-item__flag';
    flag.textContent = countryCodeToFlag(station.countrycode || '');

    const info = document.createElement('span');
    info.className = 'search-result-item__info';

    const name = document.createElement('span');
    name.className = 'search-result-item__name';
    name.append(...highlightMatch(station.name || 'Unknown Station', query));

    const meta = document.createElement('span');
    meta.className = 'search-result-item__meta';
    meta.textContent = [station.country, station.codec, station.bitrate ? `${station.bitrate} kbps` : '', station.quality?.label]
      .filter(Boolean)
      .join(' · ');

    info.append(name, meta);
    item.append(flag, info);
    searchResults!.appendChild(item);
  });

  if (filteredStations.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'search-result-item search-result-item--empty';
    empty.textContent = t('search.empty');
    searchResults.appendChild(empty);
  }
}

function onResultClick(event: MouseEvent): void {
  const item = (event.target as HTMLElement).closest('.search-result-item') as HTMLElement | null;
  if (!item || item.classList.contains('search-result-item--empty')) return;
  const index = Number.parseInt(item.dataset.index || '', 10);
  if (Number.isFinite(index)) selectStation(index);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeSearch();
    return;
  }
  if (event.key === 'Tab') {
    trapFocus(event);
    return;
  }
  if (filteredStations.length === 0) return;

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    navigateSelection(1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    navigateSelection(-1);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    selectStation(selectedIndex >= 0 ? selectedIndex : 0);
  }
}

function trapFocus(event: KeyboardEvent): void {
  if (!searchModal) return;
  const focusable = [...searchModal.querySelectorAll<HTMLElement>('input, button, [href], [tabindex]:not([tabindex="-1"])')]
    .filter(element => !(element as HTMLButtonElement).disabled && element.offsetParent !== null);
  if (focusable.length === 0) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function navigateSelection(direction: number): void {
  if (!searchResults) return;
  selectedIndex = (selectedIndex + direction + filteredStations.length) % filteredStations.length;
  const items = [...searchResults.querySelectorAll<HTMLElement>('.search-result-item')];
  items.forEach((element, index) => {
    const active = index === selectedIndex;
    element.classList.toggle('search-result-item--active', active);
    element.setAttribute('aria-selected', String(active));
    if (active) element.scrollIntoView({ block: 'nearest' });
  });
}

function selectStation(index: number): void {
  const station = filteredStations[index];
  if (!station) return;
  onSelectCallback?.(station);
  closeSearch();
}

function stationMatches(station: Station, query: string): boolean {
  const haystack = [station.name, station.country, station.countrycode, station.tags, station.language, station.codec]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

/** Returns DOM nodes with the matched span wrapped in <mark>, escaping all text safely. */
function highlightMatch(text: string, query: string): Node[] {
  if (!query) return [document.createTextNode(text)];
  const lower = text.toLowerCase();
  const index = lower.indexOf(query);
  if (index === -1) return [document.createTextNode(text)];
  const mark = document.createElement('mark');
  mark.textContent = text.slice(index, index + query.length);
  return [
    document.createTextNode(text.slice(0, index)),
    mark,
    document.createTextNode(text.slice(index + query.length))
  ];
}
