'use client';

/**
 * 服务卡片 — 可用/不可用两态
 */
export default function ServiceCard({
  icon,
  title,
  available,
  availableContent,
  unavailableContent,
}: {
  icon: string;
  title: string;
  available: boolean;
  availableContent: React.ReactNode;
  unavailableContent: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl p-5 shadow-sm border transition-all ${
      available ? 'bg-white border-green-200' : 'bg-white border-gray-200 opacity-80'
    }`}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xl">{icon}</span>
        <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
        {available && <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">可用</span>}
      </div>
      {available ? availableContent : unavailableContent}
    </div>
  );
}
