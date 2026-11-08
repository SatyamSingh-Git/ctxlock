import type { GeneratedFile } from '../build/generated.js';
import type { UnitChange } from '../diff.js';
import type { LoadMode } from '../harness/types.js';
import type { HarnessId, Unit } from '../model.js';
import { unitOwners } from '../registry/codeowners.js';
import type { Consumer, Requirement, Tier } from '../registry/registry.js';
import type { ScanResult } from '../scan.js';

export type GraphInput = Pick<ScanResult, 'units' | 'registry' | 'contexts' | 'codeowners'> & { generated: GeneratedFile[] };
type Edge = { id: string; tier?: Tier };
type Load = { harness: HarnessId; site: string; mode: LoadMode };

export interface Graph {
  units: Map<string, Unit>;
  dependsOn: Map<string, Edge[]>;
  consumers: Array<Consumer & { uses: Edge[] }>;
  // Predicted by the resolvers, not observed.
  loads: Map<string, Load[]>;
  compiledTo: Map<string, string[]>;
  dangling: Array<{ from: string; ref: string }>;
  owners(id: string): string[];
  tier(id: string): Tier;
}

// via: the unit ids from the dependent down to the unit asked about, both left out.
export interface Use {
  id: string;
  via: string[];
}

export interface ConsumerUse {
  name: string;
  owner?: string;
  maturity: Consumer['maturity'];
  via: string[];
}

export interface WhoUses {
  id: string;
  units: Use[];
  consumers: ConsumerUse[];
  loads: Load[];
  generated: string[];
}

export interface Impact {
  changed: UnitChange[];
  // on: the changed unit each one was reached from.
  dependents: Array<Use & { on: string }>;
  consumers: ConsumerUse[];
  owners: string[];
}

const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function resolveRef(ref: string, units: Unit[]): Unit | undefined {
  return units.find((u) => u.path === ref || u.id === ref || u.aliases.includes(ref));
}

export function unitChanges(base: ScanResult, head: ScanResult): UnitChange[] {
  const baseUnits = new Map(base.units.map((u) => [u.id, u]));
  const headIds = new Set(head.units.map((u) => u.id));
  const changes: UnitChange[] = [];
  for (const unit of head.units) {
    const before = baseUnits.get(unit.id);
    if (!before) changes.push({ id: unit.id, change: 'added' });
    else if (before.digest !== unit.digest) changes.push({ id: unit.id, change: 'modified' });
  }
  for (const unit of base.units) if (!headIds.has(unit.id)) changes.push({ id: unit.id, change: 'removed' });
  return changes.sort((a, b) => byKey(a.id, b.id));
}

export function buildGraph({ units, registry, contexts, codeowners, generated }: GraphInput): Graph {
  const dangling: Graph['dangling'] = [];
  const resolve = (from: string, requirements: Requirement[]) =>
    requirements.flatMap(({ ref, tier }): Edge[] => {
      const unit = resolveRef(ref, units);
      if (!unit) {
        dangling.push({ from, ref });
        return [];
      }
      return [{ id: unit.id, ...(tier && { tier }) }];
    });

  // ctxlock.yaml keys units by path, as unitOwners reads them.
  const dependsOn = new Map<string, Edge[]>();
  for (const [path, meta] of Object.entries(registry.units)) {
    const unit = units.find((u) => u.path === path);
    if (!unit) dangling.push({ from: 'ctxlock.yaml', ref: path });
    else if (meta.dependsOn) dependsOn.set(unit.id, resolve(path, meta.dependsOn));
  }
  const consumers = registry.consumers.map((c) => ({ ...c, uses: resolve(`consumer ${c.name}`, c.dependsOn) }));

  const loads = new Map<string, Load[]>();
  for (const { harness, site, entries } of contexts) {
    for (const { unitId, mode } of entries) loads.set(unitId, [...(loads.get(unitId) ?? []), { harness, site, mode }]);
  }
  const compiledTo = new Map<string, string[]>();
  for (const file of generated) {
    for (const source of file.from) {
      const unit = units.find((u) => u.files.some((f) => f.path === source.path));
      if (unit) compiledTo.set(unit.id, [...(compiledTo.get(unit.id) ?? []), file.path]);
    }
  }

  const byId = new Map(units.map((u) => [u.id, u]));
  return {
    units: byId,
    dependsOn,
    consumers,
    loads,
    compiledTo,
    dangling,
    owners: (id) => unitOwners(byId.get(id)!, registry, codeowners),
    // A unit already in git with no tier counts as reviewed (spec §4.1).
    tier: (id) => registry.units[byId.get(id)!.path]?.tier ?? 'reviewed',
  };
}

// Breadth-first over the reverse depends-on edges, so each chain is the shortest.
function reach(graph: Graph, start: string): { units: Map<string, string[]>; consumers: ConsumerUse[] } {
  const dependents = new Map<string, string[]>();
  for (const [id, edges] of graph.dependsOn) for (const edge of edges) dependents.set(edge.id, [...(dependents.get(edge.id) ?? []), id]);

  const via = new Map<string, string[]>([[start, []]]);
  const chain = (id: string) => (id === start ? [] : [id, ...via.get(id)!]);
  for (const id of via.keys()) {
    for (const dependent of dependents.get(id) ?? []) if (!via.has(dependent)) via.set(dependent, chain(id));
  }

  const consumers: ConsumerUse[] = [];
  for (const c of graph.consumers) {
    const chains = c.uses.filter((u) => via.has(u.id)).map((u) => chain(u.id));
    if (chains.length === 0) continue;
    const shortest = chains.reduce((a, b) => (b.length < a.length ? b : a));
    consumers.push({ name: c.name, ...(c.owner !== undefined && { owner: c.owner }), maturity: c.maturity, via: shortest });
  }
  via.delete(start);
  return { units: via, consumers };
}

const toUses = (units: Map<string, string[]>) => [...units].map(([id, via]) => ({ id, via })).sort((a, b) => byKey(a.id, b.id));
const byName = (a: ConsumerUse, b: ConsumerUse) => byKey(a.name, b.name);

export function whoUses(graph: Graph, id: string): WhoUses {
  const { units, consumers } = reach(graph, id);
  return { id, units: toUses(units), consumers: consumers.sort(byName), loads: graph.loads.get(id) ?? [], generated: graph.compiledTo.get(id) ?? [] };
}

// A change's blast radius. Both graphs are walked, so a change that also deletes a depends-on still
// reaches what relied on the unit before it, and a removed unit is found where it still is.
export function impactOf(base: ScanResult, head: ScanResult): Impact {
  const changed = unitChanges(base, head);
  const graphs = { base: buildGraph({ ...base, generated: base.generated.files }), head: buildGraph({ ...head, generated: head.generated.files }) };
  const changedIds = new Set(changed.map((c) => c.id));
  const dependents = new Map<string, Use & { on: string }>();
  const consumers = new Map<string, ConsumerUse>();
  const owners = new Set<string>();
  for (const { id, change } of changed) {
    for (const owner of (change === 'removed' ? graphs.base : graphs.head).owners(id)) owners.add(owner);
    for (const graph of [graphs.head, graphs.base]) {
      const reached = reach(graph, id);
      for (const [dependent, via] of reached.units) {
        if (!changedIds.has(dependent) && via.length < (dependents.get(dependent)?.via.length ?? Infinity)) dependents.set(dependent, { id: dependent, via, on: id });
      }
      for (const c of reached.consumers) if (c.via.length < (consumers.get(c.name)?.via.length ?? Infinity)) consumers.set(c.name, c);
    }
  }
  for (const c of consumers.values()) if (c.owner) owners.add(c.owner);
  return {
    changed,
    dependents: [...dependents.values()].sort((a, b) => byKey(a.id, b.id)),
    consumers: [...consumers.values()].sort(byName),
    owners: [...owners].sort(),
  };
}
