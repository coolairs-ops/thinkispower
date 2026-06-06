-- 2-1b 数据迁移：多租户回填
-- 为每个现有 user 建 personal organization + owner membership，并回填 projects.org_id。
-- 幂等：slug='user-<id>' 去重 + ON CONFLICT；projects 仅回填 org_id IS NULL。可安全重跑。

-- 1. 每个 user 一个 personal org（slug=user-<userId>，plan 沿用 user.plan 作为计费主体初值）
INSERT INTO organizations (id, name, slug, plan, created_at, updated_at)
SELECT gen_random_uuid(), COALESCE(NULLIF(name, ''), email) || ' 的空间', 'user-' || id::text, plan, now(), now()
FROM users
ON CONFLICT (slug) DO NOTHING;

-- 2. owner membership（user 在自己的 personal org 内为 owner）
INSERT INTO memberships (id, user_id, org_id, role, created_at)
SELECT gen_random_uuid(), u.id, o.id, 'owner', now()
FROM users u
JOIN organizations o ON o.slug = 'user-' || u.id::text
ON CONFLICT (user_id, org_id) DO NOTHING;

-- 3. 回填 projects.org_id（按 user 归属其 personal org；已回填的不动）
UPDATE projects p
SET org_id = o.id
FROM users u
JOIN organizations o ON o.slug = 'user-' || u.id::text
WHERE p.user_id = u.id AND p.org_id IS NULL;
