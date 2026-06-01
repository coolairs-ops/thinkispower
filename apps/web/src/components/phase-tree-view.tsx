'use client';

export interface PhaseState {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'done' | 'failed';
  color: string;
  detail?: string;
}

interface Props {
  phases: PhaseState[];
  className?: string;
}

export default function PhaseTreeView({ phases, className = '' }: Props) {
  const activeIdx = phases.findIndex(p => p.status === 'active');

  if (!phases.length) {
    return (
      <div className="py-8 text-center">
        <div className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-gray-100 text-gray-500 text-sm">
          <span>🕐</span> 等待交付启动，阶段将在此实时展示
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-0 overflow-x-auto py-4 ${className}`}>
      {phases.map((p, i) => {
        const isLast = i === phases.length - 1;
        const isActive = p.status === 'active';
        const isDone = p.status === 'done';
        const isFailed = p.status === 'failed';

        return (
          <div key={p.id} className="flex items-center gap-0 flex-shrink-0">
            {/* Phase card */}
            <div className={`flex flex-col items-center gap-1.5 min-w-[90px] px-3 py-3 rounded-xl border-2 transition-all duration-500 ${
              isActive ? 'shadow-md scale-105' : isDone ? '' : isFailed ? '' : 'opacity-60'
            }`}
              style={{
                borderColor: isDone ? '#22c55e' : isFailed ? '#ef4444' : p.color,
                background: isActive ? p.color + '12' : isDone ? '#f0fdf4' : isFailed ? '#fef2f2' : '#f9fafb',
              }}>

              {/* Status indicator */}
              <span className={`inline-flex items-center justify-center w-7 h-7 text-xs font-bold rounded-full ${
                isDone    ? 'bg-green-100 text-green-600' :
                isFailed  ? 'bg-red-100 text-red-500' :
                isActive  ? 'text-white' :
                            'bg-gray-100 text-gray-400'
              }`} style={isActive ? { background: p.color, animation: 'pulse 1.5s ease-in-out infinite' } : {}}>
                {isDone ? '✓' : isFailed ? '✕' : isActive ? '◉' : (i + 1).toString()}
              </span>

              {/* Label */}
              <span className={`text-xs font-medium text-center leading-tight ${
                isDone   ? 'text-green-700' :
                isFailed ? 'text-red-600' :
                isActive ? 'text-gray-900' :
                           'text-gray-500'
              }`}>{p.label}</span>

              {/* Detail */}
              {p.detail && (
                <span className="text-[10px] text-gray-400 text-center max-w-[80px] truncate">{p.detail}</span>
              )}
            </div>

            {/* Arrow connector */}
            {!isLast && (
              <div className="flex items-center mx-1">
                <div className={`h-0.5 w-6 ${activeIdx >= i ? 'bg-green-400' : 'bg-gray-200'}`} />
                <span className={`text-xs ${activeIdx > i ? 'text-green-500' : 'text-gray-300'}`}>▶</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
