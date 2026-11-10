export type GraphResource = Record<string, unknown> & {
  id: string; name?: string; typeId?: string; category?: string;
  businessId?: string; dataNature?: string; runStatus?: string; count?: number;
};
export type GraphRelation = GraphResource & {from: string; to: string; label?: string};
export type BusinessGraph = {view?: string; definitionId?: string; buildId?: string | null; nodes: GraphResource[]; edges: GraphRelation[]};
export type GraphScope = {businessId: string; dataNature: string; buildId?: string};
export type Point = {x: number; y: number};
export type GraphLayout = {version: 1; positions: Record<string, Point>; viewport: Point & {zoom: number}};

export function businessGraphKey(graph: BusinessGraph, scope: GraphScope) {
  if (graph.view !== 'business' || !scope.businessId || !['demo', 'business'].includes(scope.dataNature)) throw new Error('关系图范围不完整');
  const ids = new Set<string>(), edgeIds = new Set<string>();
  for (const n of graph.nodes) {
    if (typeof n.id !== 'string' || !n.id || ids.has(n.id)) throw new Error('关系图节点 ID 无效');
    if (n.businessId !== scope.businessId || n.dataNature !== scope.dataNature) throw new Error('关系图范围正在切换，请等待刷新');
    ids.add(n.id);
  }
  if ((graph.buildId ?? '') !== (scope.buildId ?? '')) throw new Error('关系图投影正在切换，请等待刷新');
  for (const e of graph.edges) {
    if (!e.id || edgeIds.has(e.id) || !ids.has(e.from) || !ids.has(e.to)) throw new Error('关系图连接无效');
    edgeIds.add(e.id);
  }
  return 'neo-ontology-flow-layout:v1:' + encodeURIComponent(JSON.stringify([
    scope.businessId, scope.dataNature, graph.view, graph.definitionId ?? '', graph.buildId ?? '',
    [...ids].sort(), graph.edges.map(e => [e.id, e.from, e.to]).sort(),
  ]));
}

export function businessGraphElements(graph: BusinessGraph) {
  const rows = new Map<number, number>();
  const lanes = [['product', 'sku', 'role'], ['order', 'order_line', 'refund', 'channel', 'event', 'expense'], ['inventory', 'warehouse', 'arrival']];
  return {
    nodes: graph.nodes.map(resource => {
      const lane = lanes.findIndex(ids => ids.includes(resource.typeId ?? '')), column = lane < 0 ? 3 : lane;
      const row = rows.get(column) ?? 0; rows.set(column, row + 1);
      return {id: resource.id, type: 'resource' as const, position: {x: 25 + column * 290, y: 65 + row * 105}, data: {resource}};
    }),
    edges: graph.edges.map(resource => ({id: resource.id, source: resource.from, target: resource.to, label: resource.label, data: {resource}})),
  };
}

export function readBusinessGraphLayout(raw: string | null, ids: string[]): GraphLayout | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || !parsed.positions || !parsed.viewport) return null;
    const positions: Record<string, Point> = {};
    for (const id of ids) {
      const p = parsed.positions[id];
      if (!p) continue;
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 1e5 || Math.abs(p.y) > 1e5) return null;
      positions[id] = {x: p.x, y: p.y};
    }
    const v = parsed.viewport;
    if (!Object.keys(positions).length || !Number.isFinite(v.x) || !Number.isFinite(v.y) || Math.abs(v.x) > 1e6 || Math.abs(v.y) > 1e6 || !Number.isFinite(v.zoom) || v.zoom < .2 || v.zoom > 2) return null;
    return {version: 1, positions, viewport: {x: v.x, y: v.y, zoom: v.zoom}};
  } catch { return null; }
}
