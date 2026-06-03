import { SkeletonList } from '@/components/skeleton-card';

export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-gray-50 p-6 animate-pulse">
      <div className="mx-auto max-w-4xl">
        <div className="h-8 bg-gray-200 rounded w-64 mb-6" />
        <div className="bg-white rounded-xl p-6 shadow-sm mb-6">
          <div className="flex gap-3 mb-4">
            <div className="h-10 bg-gray-200 rounded w-32" />
            <div className="h-10 bg-gray-100 rounded w-24" />
          </div>
          <SkeletonList rows={5} />
        </div>
      </div>
    </div>
  );
}
