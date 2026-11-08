import { isProbeFile } from '../../eval/probes.js';
import { buildGraph } from '../../graph/graph.js';
import type { Finding } from '../../model.js';
import { TIERS, type Tier } from '../../registry/registry.js';
import type { Rule } from '../types.js';

export const graphRefs: Rule = {
  id: 'L15-graph',
  async check(ctx) {
    const graph = buildGraph(ctx);
    const findings: Finding[] = [];
    const report = (message: string) => findings.push({ rule: 'L15-graph', severity: 'should', message, path: 'ctxlock.yaml' });

    for (const { from, ref } of graph.dangling) {
      report(from === 'ctxlock.yaml' ? `ctxlock.yaml lists ${ref}, which is no unit` : `${from} depends on ${ref}, which is no unit`);
    }
    const pathOf = (id: string) => graph.units.get(id)!.path;
    const needs = (from: string, edges: Array<{ id: string; tier?: Tier }>) => {
      for (const { id, tier } of edges) {
        if (tier && TIERS.indexOf(graph.tier(id)) > TIERS.indexOf(tier)) report(`${from} needs ${pathOf(id)} at ${tier}; it is ${graph.tier(id)}`);
      }
    };
    for (const [id, edges] of graph.dependsOn) needs(pathOf(id), edges);
    for (const c of graph.consumers) needs(`consumer ${c.name}`, c.uses);

    const files = await ctx.reader.listFiles();
    for (const c of graph.consumers) {
      for (const path of c.evals) {
        if (!files.some((f) => isProbeFile(f) && (f === path || f.startsWith(`${path}/`)))) report(`consumer ${c.name} lists evals ${path}, which holds no probe file`);
      }
    }
    return findings;
  },
};
