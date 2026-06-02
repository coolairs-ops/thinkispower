'use client';

/**
 * 综合评分条 — L1/L2/L3 三段进度 + 需求覆盖率
 */
export default function ScoreGauge({
  score,
  l1Score,
  l2Score,
  l3Score,
  rounds,
  coverage,
  missingCount,
}: {
  score: number;
  l1Score?: number;
  l2Score?: number;
  l3Score?: number;
  rounds: number;
  coverage?: number;
  missingCount?: number;
}) {
  const color = score >= 80 ? 'text-green-600' : score >= 50 ? 'text-yellow-600' : 'text-red-600';
  const bgClass = score >= 80 ? 'bg-green-600' : score >= 50 ? 'bg-yellow-500' : 'bg-red-500';

  return (
    <div className="mb-6 bg-white rounded-xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-gray-600">综合评分</span>
        <span className={`text-2xl font-bold ${color}`}>{score}</span>
      </div>
      <div className="flex gap-1 h-6 rounded-full overflow-hidden">
        <div className="bg-blue-400 transition-all duration-500 flex items-center justify-center text-[10px] text-gray-900 font-medium"
          style={{ width: `${l1Score ?? 33}%` }}>
          L1 {l1Score ?? 0}
        </div>
        <div className="bg-green-400 transition-all duration-500 flex items-center justify-center text-[10px] text-gray-900 font-medium"
          style={{ width: `${l2Score ?? 33}%` }}>
          L2 {l2Score ?? 0}
        </div>
        <div className="bg-purple-400 transition-all duration-500 flex items-center justify-center text-[10px] text-gray-900 font-medium"
          style={{ width: `${l3Score ?? 34}%` }}>
          L3 {l3Score ?? 0}
        </div>
      </div>
      <div className="flex justify-between mt-2 text-xs text-gray-400">
        <span>轮次: {rounds}</span>
        {coverage != null && (
          <span>需求覆盖 {coverage}% {missingCount ? `（缺失${missingCount}项）` : '✅'}</span>
        )}
      </div>
    </div>
  );
}
