'use client';

import { useState } from 'react';

export interface TreeNodeData {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'done' | 'failed';
  children?: TreeNodeData[];
  color?: string;
  icon?: string;
  detail?: string;
}

interface Props {
  nodes: TreeNodeData[];
  className?: string;
}

const PALETTE = ['#3b82f6', '#22c55e', '#a855f7', '#f97316', '#ec4899', '#14b8a6', '#eab308'];

function assignColors(nodes: TreeNodeData[], parentColor?: string, start = 0): TreeNodeData[] {
  return nodes.map((n, i) => {
    const color = n.color || (parentColor ? childColor(parentColor, i) : PALETTE[(start + i) % PALETTE.length]);
    return { ...n, color, children: n.children ? assignColors(n.children, color) : undefined };
  });
}

function childColor(p: string, i: number): string {
  const m: Record<string, string[]> = {
    '#3b82f6': ['#60a5fa', '#93c5fd', '#2563eb'],
    '#22c55e': ['#4ade80', '#86efac', '#16a34a'],
    '#a855f7': ['#c084fc', '#d8b4fe', '#9333ea'],
    '#f97316': ['#fb923c', '#fdba74', '#ea580c'],
    '#ec4899': ['#f472b6', '#f9a8d4', '#db2777'],
    '#14b8a6': ['#2dd4bf', '#5eead4', '#0d9488'],
  };
  return (m[p] || ['#9ca3af', '#d1d5db', '#6b7280'])[i % 3];
}

export default function GenerationTree({ nodes, className = '' }: Props) {
  return (
    <div className={`space-y-0.5 ${className}`}>
      {assignColors(nodes).map(n => <NodeItem key={n.id} node={n} depth={0} />)}
    </div>
  );
}

function NodeItem({ node, depth }: { node: TreeNodeData; depth: number }) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = !!node.children?.length;

  return (
    <div>
      <div className="relative flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-gray-50/60 transition-colors"
        style={{ paddingLeft: 12 + depth * 26 }}>

        {depth > 0 && (
          <div className="absolute left-0 top-0 bottom-0 w-0.5 rounded-full"
            style={{ left: 12 + (depth - 1) * 26 + 8, background: node.color + '30' }} />
        )}

        <span className={`inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold rounded-full flex-shrink-0
          ${node.status === 'done' ? 'bg-green-100 text-green-600' :
            node.status === 'failed' ? 'bg-red-100 text-red-500' :
            node.status === 'active' ? 'text-white' : 'bg-gray-100 text-gray-400'}`}
          style={node.status === 'active' ? { background: node.color, animation: 'pulse 1.5s ease-in-out infinite' } : {}}>
          {node.status === 'done' ? '✓' : node.status === 'failed' ? '✕' : node.status === 'active' ? '◉' : '○'}
        </span>

        {node.icon && <span className="text-sm flex-shrink-0">{node.icon}</span>}

        <span className={`text-sm truncate max-w-[200px]
          ${node.status === 'done' ? 'text-green-700 font-medium' :
            node.status === 'failed' ? 'text-red-600' :
            node.status === 'active' ? 'font-semibold' : 'text-gray-500'}`}
          style={node.status === 'active' ? { color: node.color } : {}}>
          {node.label}
        </span>

        {node.detail && <span className="text-xs text-gray-400 truncate max-w-[120px]">{node.detail}</span>}

        {node.status === 'active' && <span className="text-[10px] text-blue-500 animate-pulse ml-1">●</span>}

        {hasChildren && (
          <button onClick={() => setExpanded(e => !e)}
            className="ml-auto flex-shrink-0 text-xs w-5 h-5 flex items-center justify-center rounded border border-gray-200 text-gray-400 hover:text-gray-600 hover:border-gray-400 transition-colors">
            {expanded ? '−' : '+'}
          </button>
        )}
      </div>

      {hasChildren && expanded && (
        <div className="relative">
          {node.children!.map(c => <NodeItem key={c.id} node={c} depth={depth + 1} />)}
        </div>
      )}
    </div>
  );
}
