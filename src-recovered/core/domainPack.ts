// Registry for domain packs. The engine selects an active pack at runtime; radio is the
// default. Adding a pack requires no edits here. See SPEC-ENGINE-001.
import type { DomainPack } from './types';

const registry = new Map<string, DomainPack>();
let activeId: string | null = null;
let defaultId: string | null = null;

export function registerDomainPack(pack: DomainPack): void {
  registry.set(pack.id, pack);
  if (pack.isDefault) defaultId = pack.id;
  if (!activeId) activeId = defaultId ?? pack.id;
}

export function getDomainPack(id: string): DomainPack | undefined {
  return registry.get(id);
}

export function listDomainPacks(): DomainPack[] {
  return [...registry.values()];
}

export function getDefaultDomainPack(): DomainPack | undefined {
  if (defaultId && registry.has(defaultId)) return registry.get(defaultId);
  return registry.values().next().value;
}

export function setActiveDomain(id: string): DomainPack | undefined {
  if (registry.has(id)) activeId = id;
  return getActiveDomain();
}

export function getActiveDomain(): DomainPack | undefined {
  if (activeId && registry.has(activeId)) return registry.get(activeId);
  return getDefaultDomainPack();
}

/** Test/support helper: clears the registry. */
export function resetDomainPacks(): void {
  registry.clear();
  activeId = null;
  defaultId = null;
}
