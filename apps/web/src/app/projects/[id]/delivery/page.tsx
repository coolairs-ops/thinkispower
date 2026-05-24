'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function DeliveryPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const [delivery, setDelivery] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { router.push('/'); return; }

    fetch(`/api/projects/${projectId}/delivery`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        setDelivery(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [projectId, router]);

  const handleConfirmDelivery = async () => {
    const token = localStorage.getItem('token');
    await fetch(`/api/projects/${projectId}/delivery/confirm`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    alert('感谢你的确认！');
  };

  const handleRequestExport = async (type: string) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/projects/${projectId}/delivery/request-${type}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.upgradeRequired) {
      alert('这是高级交付服务，如需开通请联系平台顾问。');
    } else {
      alert('已收到请求，平台正在处理。');
    }
  };

  if (loading) return <div className="p-8 text-gray-500">加载中...</div>;

  return (
    <div className="min-h-screen bg-gray-50 px-6 py-8">
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-6 text-2xl font-bold text-gray-900">交付</h1>

        {/* Online Access */}
        <section className="mb-6 rounded-xl bg-white p-6 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold text-gray-800">在线访问</h2>
          {delivery?.productionUrl ? (
            <div>
              <a
                href={delivery.productionUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                {delivery.productionUrl}
              </a>
              <p className="mt-2 text-sm text-gray-500">
                管理员账号：{delivery.adminEmail || 'admin@example.com'} / 密码请联系平台
              </p>
            </div>
          ) : (
            <p className="text-gray-400">尚未部署</p>
          )}
        </section>

        {/* Actions */}
        <section className="mb-6 rounded-xl bg-white p-6 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold text-gray-800">操作</h2>
          <div className="flex flex-wrap gap-3">
            {delivery?.productionUrl && (
              <a
                href={delivery.productionUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
              >
                打开软件
              </a>
            )}
            <button
              onClick={handleConfirmDelivery}
              className="rounded-lg border px-4 py-2 text-gray-700 hover:bg-gray-50"
            >
              确认交付
            </button>
            <button
              onClick={() => router.push(`/projects/${projectId}/demo`)}
              className="rounded-lg border px-4 py-2 text-gray-700 hover:bg-gray-50"
            >
              继续修改
            </button>
          </div>
        </section>

        {/* Advanced Delivery */}
        <section className="rounded-xl bg-white p-6 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold text-gray-800">高级交付服务</h2>
          <div className="grid grid-cols-2 gap-3">
            {[
              { key: 'source-download', label: '下载源码' },
              { key: 'package-export', label: '导出项目包' },
              { key: 'repository-transfer', label: '交付到我的代码仓库' },
              { key: 'database-export', label: '导出数据库结构' },
              { key: 'deployment-config', label: '导出部署配置' },
            ].map((item) => (
              <button
                key={item.key}
                onClick={() => handleRequestExport(item.key)}
                className="rounded-lg border p-4 text-left text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                {item.label}
                {!delivery?.isPro && (
                  <p className="mt-1 text-xs text-gray-400">这是高级交付服务，如需开通请联系平台顾问。</p>
                )}
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
