import { SkeletonCard } from '@/components/skeleton-card';

export default function ProjectLoading() {
  return (
    <div className="min-h-screen bg-gray-50 p-6 animate-pulse">
      <div className="mx-auto max-w-4xl">
        <div className="h-8 bg-gray-200 rounded w-48 mb-6" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-xl p-5 shadow-sm space-y-3">
            <div className="h-5 bg-gray-200 rounded w-1/3" />
            <div className="h-4 bg-gray-100 rounded w-2/3" />
            <div className="h-4 bg-gray-100 rounded w-1/2" />
          </div>
          <div className="bg-white rounded-xl p-5 shadow-sm space-y-3">
            <div className="h-5 bg-gray-200 rounded w-1/3" />
            <div className="flex gap-2">
              <div className="h-8 bg-gray-200 rounded w-16" />
              <div className="h-8 bg-gray-100 rounded w-16" />
              <div className="h-8 bg-gray-100 rounded w-16" />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
      </div>
    </div>
  );
}
