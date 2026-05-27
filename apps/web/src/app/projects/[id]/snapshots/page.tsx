'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import NavBar from '@/lib/nav-bar';

interface Snapshot {
  id: string;
  version: number;
  source: string;
  taskId: string | null;
  createdAt: string;
}

const SOURCE_LABELS: Record<string, string> = {
  demo_generate: 'Demo 生成',
  pipeline_execute: '流水线修改',
  manual_rollback: '回滚前备份',
};

export default function SnapshotsPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const { token, isLoading } = useAuth();

  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [projectName, setProjectName] = useState('');
  const [loading, setLoading] = useState(true);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewVersion, setPreviewVersion] = useState<number | null>(null);
  const [rollingBack, setRollingBack] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading) return;
    if (!token) { router.push('/'); return; }

    Promise.all([
      api.get(`/api/projects/${projectId}/demo/snapshots`),
      api.get(`/api/projects/${projectId}`),
    ])
      .then(([sns, proj]) => {
        setSnapshots(Array.isArray(sns) ? sns : []);
        setProjectName(proj.name || '');
        setLoading(false);
      })
      .catch((err) => {
        setLoading(false);
        setError(err.message || '加载失败');
      });
  }, [projectId, token, isLoading, router]);

  const handlePreview = async (snapshot: Snapshot) => {
    if (previewVersion === snapshot.version) {
      setPreviewHtml(null);
      setPreviewVersion(null);
      return;
    }
    try {
      const data = await api.get(`/api/projects/${projectId}/demo/snapshots/${snapshot.id}`);
      setPreviewHtml(data.html || null);
      setPreviewVersion(snapshot.version);
    } catch (err: any) {
      setError(err.message || '加载快照失败');
    }
  };

  const handleRollback = async (snapshot: Snapshot) => {
    if (!confirm(`确定回滚到 v${snapshot.version}？当前 Demo 将先保存为备份快照。`)) return;

    setRollingBack(true);
    setError(null);
    try {
      await api.post(`/api/projects/${projectId}/demo/rollback`, { snapshotId: snapshot.id });
      // Refresh list (rollback creates a manual_rollback snapshot)
      const sns = await api.get(`/api/projects/${projectId}/demo/snapshots`);
      setSnapshots(Array.isArray(sns) ? sns : []);
      setPreviewHtml(null);
      setPreviewVersion(null);
      router.push(`/projects/${projectId}/demo`);
    } catch (err: any) {
      setError(err.message || '回滚失败');
    }
    setRollingBack(false);
  };

  if (isLoading) return null;
  if (loading) return <div className="p-8 text-gray-500">加载中...</div>;

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar projectId={projectId} projectName={projectName} />

      <div className="px-6 py-8">
        <div className="mx-auto max-w-5xl">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-gray-900">历史版本</h1>
            <button
              onClick={() => router.push(`/projects/${projectId}/demo`)}
              className="rounded-lg border px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              ← 返回预览
            </button>
          </div>

          {error && (
            <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
          )}

          {snapshots.length === 0 ? (
            <div className="rounded-xl bg-white p-12 text-center shadow-sm">
              <p className="text-gray-400">暂无历史版本</p>
              <p className="mt-1 text-xs text-gray-300">生成 Demo 后会自动创建版本快照</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* 快照列表 */}
              <div className="rounded-xl bg-white p-4 shadow-sm">
                <div className="space-y-2">
                  {snapshots.map((sn, i) => (
                    <div
                      key={sn.id}
                      className={`rounded-lg border p-3 transition-colors ${
                        previewVersion === sn.version
                          ? 'border-blue-300 bg-blue-50'
                          : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-800">v{sn.version}</span>
                            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                              {SOURCE_LABELS[sn.source] || sn.source}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-gray-400">
                            {new Date(sn.createdAt).toLocaleString('zh-CN')}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <button
                            onClick={() => handlePreview(sn)}
                            className="rounded px-2 py-1 text-xs text-blue-600 hover:bg-blue-100"
                          >
                            {previewVersion === sn.version ? '关闭' : '预览'}
                          </button>
                          {i > 0 && (
                            <button
                              onClick={() => handleRollback(sn)}
                              disabled={rollingBack}
                              className="rounded px-2 py-1 text-xs text-orange-600 hover:bg-orange-100 disabled:opacity-50"
                            >
                              {rollingBack ? '回滚中...' : '回滚'}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 预览区域 */}
              <div className="rounded-xl bg-white shadow-sm overflow-hidden">
                {previewHtml ? (
                  <iframe
                    srcDoc={previewHtml}
                    className="h-[600px] w-full"
                    title="快照预览"
                    sandbox="allow-scripts allow-same-origin"
                  />
                ) : (
                  <div className="flex h-[600px] items-center justify-center">
                    <div className="text-center">
                      <p className="text-gray-400">点击快照的"预览"按钮查看</p>
                      <p className="mt-1 text-xs text-gray-300">版本 v{snapshots[0]?.version || ''}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
