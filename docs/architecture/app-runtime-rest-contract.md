# 应用后端 REST 约定（路 B / ADR-0001）

本约定是**前端 ↔ 后端运行时**之间的契约。路 B 的固定 CRUD 运行时与路 C 的生成代码后端**都必须满足它**——这样前端调用代码在 B/C 之间零改动（防绕路约束①）。

> 形态刻意贴近"一个生成出来的 NestJS/Express CRUD 后端会暴露的样子"：标准 REST + JSON，无私有 DSL、无 GraphQL、无自定义信封约定之外的东西。

## 基址

```
/api/app/:projectId/:resource
```

- `:projectId` — 项目 UUID，运行时据此 scope 到该项目的 Postgres schema（`proj_<id>`）。
- `:resource` — 数据模型里的表名（小写资源名，如 `todo`、`customer`）。

## 端点

| 方法 | 路径 | 含义 |
|------|------|------|
| GET | `/api/app/:projectId/:resource` | 列表（分页/过滤/排序） |
| GET | `/api/app/:projectId/:resource/:id` | 取单条 |
| POST | `/api/app/:projectId/:resource` | 新建 |
| PUT | `/api/app/:projectId/:resource/:id` | 全量更新 |
| PATCH | `/api/app/:projectId/:resource/:id` | 局部更新 |
| DELETE | `/api/app/:projectId/:resource/:id` | 删除 |

## 列表查询参数

- **分页**：`?page=1&pageSize=20`（`pageSize` 上限 100，默认 20）。
- **排序**：`?sort=field:asc` 或 `?sort=field:desc`（多字段用逗号）。
- **过滤**：`?<field>=<value>` 直接相等过滤；区间/模糊等高级过滤 v1 不做。

## 响应信封

列表：
```json
{ "data": [ { ... } ], "page": 1, "pageSize": 20, "total": 137 }
```

单条 / 新建 / 更新：
```json
{ "data": { "id": "...", ... } }
```

错误（面向普通用户的文案在更外层翻译，这里是契约层）：
```json
{ "error": { "code": "NOT_FOUND", "message": "..." } }
```

错误码 v1 集合：`NOT_FOUND` `VALIDATION` `CONFLICT` `INTERNAL`。

## 前端如何调用

demo（单文件 daisyUI SPA）通过注入的 `appData` helper 调用，不直接拼 URL（slice 5）：

```js
await appData.list('todo', { page: 1, pageSize: 20, sort: 'createdAt:desc' });
await appData.get('todo', id);
await appData.create('todo', { title: '买菜', done: false });
await appData.update('todo', id, { done: true });
await appData.remove('todo', id);
```

`appData` 内部就是对上面 REST 的薄封装，base = `/api/app/<当前projectId>/`。
路 C 切换后端实现时，只要后端仍满足本约定，`appData` 与所有前端调用**一行都不用改**。

## v1 显式不做

- 自定义业务逻辑 / 计算型端点
- per-app 鉴权（待 v1 范围决策）
- 文件 / 对象上传
- 实时 / WebSocket
- 复杂关系展开（v1 仅简单外键标量字段）
