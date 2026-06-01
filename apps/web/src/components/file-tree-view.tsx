'use client';

import { useMemo, useState } from 'react';

export interface FileTreeFile {
  path: string;
  status: 'pending' | 'generating' | 'done' | 'failed';
}

interface FileNode {
  name: string;
  type: 'folder' | 'file';
  children: FileNode[];
  path: string;
  status: 'pending' | 'generating' | 'done' | 'failed';
  ext: string;
}

const EXT_STYLE: Record<string, { color: string; icon: string }> = {
  ts:   { color: '#3178c6', icon: '🔵' },
  tsx:  { color: '#3178c6', icon: '⚛️' },
  js:   { color: '#f7df1e', icon: '🟡' },
  jsx:  { color: '#61dafb', icon: '⚛️' },
  css:  { color: '#1572b6', icon: '🎨' },
  scss: { color: '#cc6699', icon: '🎨' },
  json: { color: '#292929', icon: '📋' },
  html: { color: '#e34f26', icon: '🌐' },
  md:   { color: '#083fa1', icon: '📝' },
  svg:  { color: '#ffb13b', icon: '🖼️' },
  vue:  { color: '#42b883', icon: '💚' },
  py:   { color: '#3572A5', icon: '🐍' },
  go:   { color: '#00ADD8', icon: '🔷' },
};

function extOf(p: string) { const i = p.lastIndexOf('.'); return i > 0 ? p.slice(i + 1).toLowerCase() : ''; }

function buildTree(files: FileTreeFile[]): FileNode[] {
  const root: FileNode[] = [];
  for (const file of files) {
    const parts = file.path.split('/');
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const last = i === parts.length - 1;
      const name = parts[i];
      const found = cur.find(n => n.name === name && n.type === (last ? 'file' : 'folder'));
      if (found) { cur = found.children; }
      else if (last) {
        cur.push({ name, type: 'file', children: [], path: file.path, status: file.status, ext: extOf(name) });
      } else {
        const f: FileNode = { name, type: 'folder', children: [], path: parts.slice(0, i + 1).join('/'), status: 'pending', ext: '' };
        cur.push(f); cur = f.children;
      }
    }
  }
  return root;
}

export default function FileTreeView({ files, className = '', emptyMessage }: { files: FileTreeFile[]; className?: string; emptyMessage?: string }) {
  const tree = useMemo(() => buildTree(files), [files]);

  if (!tree.length) {
    return <div className="py-12 text-center text-gray-400 text-sm">{emptyMessage || '暂无文件，开始交付后将实时显示'}</div>;
  }

  return (
    <div className={`text-sm font-mono ${className}`}>
      {tree.map(n => <NodeItem key={n.path || n.name} node={n} depth={0} />)}
    </div>
  );
}

function NodeItem({ node, depth }: { node: FileNode; depth: number }) {
  const [expanded, setExpanded] = useState(true);
  const style = EXT_STYLE[node.ext];

  return (
    <div>
      <div className="flex items-center gap-1.5 py-1 px-2 rounded hover:bg-gray-50 transition-colors cursor-default"
        style={{ paddingLeft: 8 + depth * 20 }}>
        {node.type === 'folder' ? (
          <span className="text-xs w-4 text-center text-gray-400"
            onClick={() => setExpanded(e => !e)}>{expanded ? '▼' : '▶'}</span>
        ) : (
          <span className="text-xs w-4 text-center">
            {node.status === 'done'      ? <span className="text-green-500">✓</span> :
             node.status === 'generating' ? <span className="text-blue-500 animate-pulse">◉</span> :
             node.status === 'failed'    ? <span className="text-red-500">✕</span> :
                                            <span className="text-gray-300">○</span>}
          </span>
        )}

        {node.type === 'folder'
          ? <span className="text-gray-400 mr-0.5">{expanded ? '📂' : '📁'}</span>
          : <span className="mr-0.5">{style?.icon || '📄'}</span>}

        <span className={`text-sm ${node.type === 'folder' ? 'font-medium text-gray-700' : ''}`}
          style={node.type === 'file' ? { color: style?.color || '#6b7280' } : {}}>
          {node.name}
        </span>

        {node.status === 'generating' && <span className="text-[10px] text-blue-500 animate-pulse ml-1">生成中</span>}
      </div>

      {node.type === 'folder' && expanded && node.children.map(c =>
        <NodeItem key={c.path || c.name} node={c} depth={depth + 1} />)}
    </div>
  );
}
