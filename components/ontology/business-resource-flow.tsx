'use client';
import {useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {ReactFlow, Background, MiniMap, Handle, Position, MarkerType, useNodesState, type Node, type NodeProps, type ReactFlowInstance, type Viewport} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {businessGraphElements, readBusinessGraphLayout, type BusinessGraph, type GraphResource, type GraphRelation} from '../../lib/ontology-business-graph';
import styles from './business-resource-flow.module.css';
import common from './workbench.module.css';

type ResourceNode = Node<{resource: GraphResource}, 'resource'>;
type ResourceEdge = {id: string; source: string; target: string; label?: string; data: {resource: GraphRelation}};
function ResourceCard({data}: NodeProps<ResourceNode>) {
  const r = data.resource;
  return <div className={styles.node} data-resource-id={r.id}>
    <Handle type="target" position={Position.Left} isConnectable={false}/>
    <strong>{r.name ?? r.id}</strong><span>{r.category} · {r.runStatus}{r.count !== undefined ? ` · ${r.count}` : ''}</span><code>{r.id}</code>
    <Handle type="source" position={Position.Right} isConnectable={false}/>
  </div>;
}
const nodeTypes = {resource: ResourceCard};

type FlowProps = {graph: BusinessGraph; storageKey: string; selectedId?: string; onSelect: (resource: GraphResource) => void};
const subscribeClient = () => () => {};
export default function BusinessResourceFlow(props: FlowProps) {
  const client = useSyncExternalStore(subscribeClient, () => true, () => false);
  return client ? <ClientResourceFlow {...props}/> : <p role="status">正在读取关系图布局…</p>;
}
function ClientResourceFlow({graph, storageKey, selectedId, onSelect}: FlowProps) {
  const elements = useMemo(() => businessGraphElements(graph), [graph]);
  const [initial] = useState(() => {
    let layout = null, message = '拖动与缩放会保存到本浏览器';
    try {
      const raw = localStorage.getItem(storageKey);
      layout = readBusinessGraphLayout(raw, elements.nodes.map(n => n.id));
      if (raw && !layout) message = '保存布局不可用，已恢复默认布局';
      else if (layout) message = '已恢复当前范围的布局';
    } catch { message = '本机存储不可用，仍可操作关系图'; }
    return {layout, message};
  });
  const [nodes, setNodes, onNodesChange] = useNodesState<ResourceNode>(elements.nodes.map(n => ({...n, position: initial.layout?.positions[n.id] ?? n.position})));
  const [notice, setNotice] = useState(initial.message);
  const [viewport, setViewport] = useState<Viewport>(initial.layout?.viewport ?? {x: 0, y: 0, zoom: 1});
  const restoredViewport = initial.layout?.viewport;
  const [focus, setFocus] = useState(false);
  const flow = useRef<ReactFlowInstance<ResourceNode, ResourceEdge> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => {if (saveTimer.current) clearTimeout(saveTimer.current);}, []);

  function save(current = flow.current?.getNodes(), view = flow.current?.getViewport()) {
    if (!current || !view) return;
    try {
      const positions = Object.fromEntries(current.map(n => [n.id, n.position]));
      localStorage.setItem(storageKey, JSON.stringify({version: 1, positions, viewport: view}));
      setNotice('布局已保存到本浏览器');
    } catch { setNotice('无法保存布局；当前会话仍可操作'); }
  }
  function scheduleSave() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(), 150);
  }
  async function adjustView(action: 'in' | 'out' | 'fit') {
    const instance = flow.current; if (!instance) return;
    if (action === 'in') await instance.zoomIn();
    else if (action === 'out') await instance.zoomOut();
    else await instance.fitView({padding: .15, maxZoom: 1});
    save();
  }
  async function reset() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    try {localStorage.removeItem(storageKey);} catch {/* Session remains operable. */}
    setNodes(elements.nodes); setFocus(false);
    await flow.current?.fitView({padding: .15, maxZoom: 1});
    save(); setNotice('已恢复默认位置并保存');
  }
  const selectedNodeId = nodes.some(n => n.id === selectedId) ? selectedId : undefined;
  const adjacent = new Set([selectedNodeId, ...graph.edges.filter(e => e.from === selectedNodeId || e.to === selectedNodeId).flatMap(e => [e.from, e.to])]);
  const resources = new Map(graph.nodes.map(r => [r.id, r]));
  const displayedNodes = nodes.map(n => ({...n, data: {resource: resources.get(n.id) ?? n.data.resource}, selected: n.id === selectedId, hidden: focus && !!selectedNodeId && !adjacent.has(n.id)}));
  const edges = elements.edges.map(e => ({...e, selected: e.id === selectedId, hidden: focus && !!selectedNodeId && (!adjacent.has(e.source) || !adjacent.has(e.target)), markerEnd: {type: MarkerType.ArrowClosed, color: '#809da9'}, style: {stroke: e.id === selectedId ? '#206a80' : '#aec3cc', strokeWidth: e.id === selectedId ? 2.5 : 1.5}, labelStyle: {fontSize: 11}, labelBgStyle: {fill: '#f6f9fa'}, interactionWidth: 24}));
  if (!nodes.length) return <p role="status">当前范围暂无对象类型。</p>;
  return <div className={styles.frame} data-layout-key={storageKey} data-graph-renderer="react-flow">
    <div className={common.row}>
      <button className={common.secondary} onClick={() => void adjustView('in')}>放大</button>
      <button className={common.secondary} onClick={() => void adjustView('out')}>缩小</button>
      <output aria-label="关系图缩放">{Math.round(viewport.zoom * 100)}%</output>
      <button className={common.secondary} onClick={() => void adjustView('fit')}>适应视图</button>
      <button className={common.secondary} disabled={!selectedNodeId} onClick={() => setFocus(v => !v)}>{focus ? '显示全部' : '聚焦邻接节点'}</button>
      <button className={common.secondary} onClick={() => save()}>保存布局</button>
      <button className={common.secondary} onClick={() => void reset()}>恢复默认布局</button>
    </div>
    <div className={styles.canvas}>
      <ReactFlow<ResourceNode, ResourceEdge> nodes={displayedNodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={changes => {onNodesChange(changes); const choice = changes.find(c => c.type === 'select' && c.selected); if (choice && 'id' in choice) {const resource = resources.get(choice.id); if (resource) onSelect(resource);} if (changes.some(c => c.type === 'position')) scheduleSave();}}
        onInit={instance => {flow.current = instance;}} defaultViewport={restoredViewport} fitView={!restoredViewport} fitViewOptions={{padding: .15, maxZoom: 1}}
        onNodeClick={(_, node) => onSelect(node.data.resource)} onEdgeClick={(_, edge) => onSelect(edge.data.resource)}
        onNodeDragStop={(_, node) => save(flow.current?.getNodes().map(n => n.id === node.id ? {...n, position: node.position} : n))}
        onMove={(_, view) => setViewport(view)} onMoveEnd={(event, view) => {setViewport(view); if (event) save(undefined, view);}}
        minZoom={.2} maxZoom={2} nodesConnectable={false} edgesReconnectable={false} deleteKeyCode={null}>
        <Background color="#d7e3e8" gap={22}/><MiniMap pannable zoomable maskColor="rgba(239,245,248,.7)" nodeColor="#93b4c1"/>
      </ReactFlow>
    </div>
    <p className={styles.status} role="status">{notice} · 拖动仅改变本机布局，不修改对象与关系。</p>
    <details><summary>连接清单（可查看约束和映射）</summary>{graph.edges.map(e => <button key={e.id} className={common.secondary} onClick={() => onSelect(e)}>{e.from} → {e.to} · {e.label}</button>)}</details>
  </div>;
}
