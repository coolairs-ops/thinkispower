-- ADR-0009: 把上线门结局从生命周期 status 字段分离到独立的 go_live_status，
-- 避免门失败态污染生命周期状态机（contract_violation/smoke_failed/preview_only 不在转换表里 → 孤儿态卡死）。

-- 新增字段：null = 未交付/未经上线门
ALTER TABLE "projects" ADD COLUMN "go_live_status" TEXT;

-- 回填：把被门结局污染的生命周期 status 搬到 go_live_status，并把 status 还原成可再交付的安全态。
UPDATE "projects"
SET "go_live_status" = "status", "status" = 'demo_ready'
WHERE "status" IN ('contract_violation', 'smoke_failed', 'deploy_failed', 'preview_only', 'build_failed');

-- 说明：legacy status='completed'（用户采纳 / 旧版恒置）保留为生命周期 'completed'；
-- 其 go_live_status 维持 NULL = 诚实表示"未经新上线门验证"，即使有旧 production_url 也不冒充已上线。
