# 业务流程总图

```mermaid
flowchart TB
    %% ===== 用户层 =====
    subgraph User["用户层"]
        A[注册/登录] --> B[创建项目]
    end

    %% ===== 需求阶段 =====
    subgraph Req["需求发现阶段"]
        B --> C{发送消息}
        C --> D[ProductDiscovery<br/>AI 需求分析]
        C --> E[HermesQuality<br/>AI 质量验证]
        D --> F{需求充分?}
        F -->|否| C
        F -->|是| G[prd_ready<br/>结构化需求完成]
    end

    %% ===== 方案阶段 =====
    subgraph Plan["方案阶段"]
        G --> H[GET /plan<br/>PlanGenerator<br/>AI 生成方案]
        H --> I[plan_ready<br/>方案已生成]
        I --> J[DesignAdvisor<br/>AI 设计建议]
        J --> K[PUT /plan/confirm<br/>确认方案]
        K --> L[demo_generating]
    end

    %% ===== Demo 生成 =====
    subgraph Demo["Demo 生成阶段"]
        L --> M{生成路径选择}
        M -->|N8N 优先| N[N8N 工作流<br/>demo-generate]
        M -->|降级| O[Cloudecode<br/>generateDemoHtml<br/>DeepSeek 生成 SPA HTML]
        N --> P[injectAnnotationSupport<br/>注入批注高亮]
        O --> P
        P --> Q[QualityGate<br/>HTML 质量门禁]
        Q --> R{demo_ready<br/>通过?}
        R -->|否| M
        R -->|是| S[demo_ready<br/>预览可用]
    end

    %% ===== 反馈闭环 =====
    subgraph Feedback["反馈迭代闭环"]
        S --> T[用户预览 + 批注]
        T --> U[POST /feedback<br/>创建批注]
        U --> V[FEEDBACK_CREATED 事件]
        V --> W[HermesListener<br/>AI 分解反馈]
        W --> X{N8N 可用?}
        X -->|是| Y[N8N 任务编排]
        X -->|否| Z[PipelineService 本地执行]
        Y --> AA[Cloudecode<br/>执行修改任务]
        Z --> AA
        AA --> AB{TASKS_COMPLETED<br/>全部成功?}
        AB -->|是| AC[feedback resolved<br/>回到 demo_ready]
        AB -->|否| AD[重试 3 次]
        AD -->|成功| AC
        AD -->|失败| AE[人工介入]
    end

    %% ===== 交付阶段 =====
    subgraph Delivery["交付阶段"]
        S --> AF[POST /confirm-delivery<br/>确认交付]
        AF --> AG[HermesClient<br/>AI 分析交付需求]
        AG --> AH[BuildService<br/>创建 Build]
        AH --> AI[创建导出任务<br/>源码/包/部署]
        AI --> AJ[PipelineService<br/>执行任务链]
        AJ --> AK[Cloudecode<br/>生成全栈项目]
        AK --> AL[MinIO 存储<br/>构建产物]
        AL --> AM{任务类型}
        AM -->|源码导出| AN[sourceZip 完成]
        AM -->|包导出| AO[packageZip 完成]
        AM -->|部署| AP[DeploymentService<br/>部署到 Internal/Railway]
        AN --> AQ[TASKS_COMPLETED]
        AO --> AQ
        AP --> AQ
        AQ --> AR{交付完成}
        AR --> AS[completed<br/>交付完成]
        AS --> AT[CaseReview<br/>AI 案例复盘]
        AS --> AU[ExperienceRecommendation<br/>AI 经验沉淀]
    end

    %% ===== 企业级全栈交付 =====
    subgraph Enterprise["企业级全栈交付"]
        S --> AV[POST /production-deliver]
        AV --> AW[Cloudecode<br/>deliverFullstack]
        AW --> AX[SSE 实时进度<br/>delivery-progress]
        AX --> AY[DeploymentService<br/>部署上线]
        AY --> AZ[productionUrl<br/>完成]
    end

    %% ===== Pro 自动迭代 =====
    subgraph AutoIterate["Pro 自动迭代引擎"]
        S --> BA[POST /auto-iterate/start]
        BA --> BB[循环: max 10 轮]
        BB --> BC[SENSE<br/>SensorService 全方位检测]
        BC --> BD[L1 静态: HTML/JS/CSS]
        BC --> BE[L2 运行时: 数据库/服务]
        BC --> BF[L3 语义: AI 完整性评估]
        BD --> BG[SensorFusion<br/>加权评分]
        BE --> BG
        BF --> BG
        BG --> BH{评分 >= 90?}
        BH -->|是| BI[完成]
        BH -->|否| BJ[FIX<br/>AI 自动修复]
        BJ --> BK[DECIDE<br/>用户决策]
        BK -->|继续| BB
        BK -->|接受| BI
        BK -->|停滞 3 轮| BI
    end

    %% ===== 传感器系统(全时运行) =====
    subgraph Sensors["传感器系统(全时监测)"]
        L1[L1StaticSensor<br/>结构/体积/覆盖率]
        L2[L2RuntimeSensor<br/>DB/服务/事件健康]
        L3[L3SemanticSensor<br/>AI 语义/闭环率]
        Fusion[SensorFusionService<br/>加权融合 L1=30% L2=20% L3=50%]
        L1 --> Fusion
        L2 --> Fusion
        L3 --> Fusion
    end

    %% ===== 状态机总览 =====
    subgraph StateMachine["项目状态机 (22 个状态)"]
        direction LR
        S1[needs_input] --> S2[clarifying] --> S3[prd_ready]
        S3 --> S4[plan_ready] --> S5[demo_generating]
        S5 --> S6[demo_ready] --> S7[exporting]
        S7 --> S8[completed]
        S6 -.->|反馈| S9[fixing] -.-> S6
        S7 -.->|失败| S10[build_failed] -.-> S7
        S7 -.->|部署中| S11[deploying] -.-> S8
    end

    %% ===== 图例 =====
    subgraph Legend["图例"]
        L01(["用户操作"])
        L02(["AI 服务调用"])
        L03(["系统事件"])
        L04(["状态节点"])
        L05{"决策分支"}
    end
```

## 核心业务路径

### 1. 主链路（用户 → 交付）
```
注册 → 创建项目 → 聊天澄清需求 → PRD 确认 → 方案生成 → Demo 生成 → 预览批注 → 交付完成
```

### 2. 反馈迭代闭环
```
预览批注 → AI 分解 → N8N/Pipeline 执行 → 自动验证 → Demo 更新
```

### 3. Pro 自动迭代
```
传感器检测 → AI 修复 → 用户决策 → 循环直到 ≥90 分
```

## 事件驱动架构

| 事件 | 触发点 | 消费者 | 作用 |
|------|--------|--------|------|
| `feedback.created` | 用户提交批注 | HermesListener | 自动分解反馈为任务 |
| `tasks.created` | 任务分配 | PipelineService | 执行修改/导出/部署 |
| `tasks.completed` | 任务完成 | DeliveryService | 推进状态机 |
| `delivery.export.requested` | 导出请求 | DeliveryOrchestrator | 处理各类导出 |
| `task.failed` | 任务失败 | FeedbackService | 标记重试状态 |

## AI 服务依赖关系

```
DeepSeek API
├── ProductDiscovery      → 需求澄清
├── HermesQuality         → PRD 质量验证
├── PlanGenerator         → 方案生成
├── DesignAdvisor          → 设计建议
├── HermesClient          → 反馈分解、交付分析
├── CloudecodeClient      → Demo 生成、代码修改
├── HtmlValidator         → 结构验证
├── CaseReview            → 案例复盘
├── ExperienceRecommendation → 经验沉淀
└── IterativeOptimizer    → 自动优化
```
