# 需求自动补全工具包（Requirement Completion Kit）

> 用途：本文件是一套可直接接入「自动编程平台」的需求补全流水线规范。它把"让大模型自由补需求"改造成"结构化 IR + 清单逐项扫描 + 原型库 + 若依能力锚定 + 多角色评审"的可复现流程，目标是在已有 30 题需求采集的基础上，尽可能高地补全遗漏的按钮、流程、状态、权限、边界等隐性需求。
>
> 阅读对象：① 平台后端/编排层工程师（按"集成说明"接线）；② 被调用的编程/产品大模型（按各阶段提示词执行）。
>
> 约定：所有 `{{变量}}` 为运行时注入的占位符。所有"输出格式"为严格 JSON，模型不得输出 JSON 以外的任何解释文字。
>
> 升级层见 [需求自动补全工具包 v2](requirement-completion-kit-v2.md)（在本 kit 上加 IR 完备性批判 / 按来源定信任 / 处置分类 / 两遍补全）。

---

## 0. 整体流水线（编排层按此顺序调用）

```
30题采集结果(散文/键值)
   │
   ▼
[阶段0] 建模          → 产出 IR（结构化中间表示，JSON）
   │
   ▼
[阶段1] 派生式补全     → 规则代码，不调模型；按实体机械派生标准CRUD与必备状态，写回IR
   │
   ▼
[阶段2] 清单驱动扫描   → 调模型；对IR逐实体/页面/流程对照"补全分类法"找缺口 → gap[]
   │
   ▼
[阶段3] 多角色评审     → 调模型N次（产品/交互/QA/真实用户）→ 各自gap[]，合并去重
   │
   ▼
[阶段4] 一致性+可实现性校验 → 调模型；跨页面一致性检查 + 映射若依能力，标注supported
   │
   ▼
[阶段5] 收敛为采纳卡片 → 排序/去重/打默认勾选，产出前端可渲染的 gap card 列表
   │
   ▼
用户在界面逐条"采纳/忽略" → 采纳项合并回IR → 进入代码生成
```

关键原则：**召回率主要来自分类法和原型库的覆盖度，而非提示词措辞。** 提示词只是执行器。阶段1能用规则解决的绝不交给模型（召回率100%、省token）；阶段2/3靠"给模型一张必须逐项回答的清单"提高召回，而不是靠开放式发挥。

---

## 1. IR JSON Schema（中间表示，整套流程的地基）

阶段0产出、后续所有阶段读写的统一数据结构。字段名用英文（便于程序处理），值与描述用中文。

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "AppIR",
  "type": "object",
  "required": ["app", "archetype", "entities", "screens", "navigation", "roles", "flows"],
  "properties": {
    "app": {
      "type": "object",
      "properties": {
        "name": { "type": "string", "description": "应用名称" },
        "description": { "type": "string", "description": "一句话定位" },
        "platform": { "type": "string", "enum": ["mobile", "web", "both"], "description": "目标端" }
      }
    },
    "archetype": {
      "type": "string",
      "description": "应用原型，用于匹配原型需求库",
      "examples": ["CRM", "进销存", "任务管理", "预约", "审批", "内容管理", "工单"]
    },
    "entities": {
      "type": "array",
      "description": "数据实体；几乎所有隐性需求都从这里派生",
      "items": {
        "type": "object",
        "required": ["key", "label", "fields"],
        "properties": {
          "key": { "type": "string", "description": "英文标识，如 customer" },
          "label": { "type": "string", "description": "中文名，如 客户" },
          "fields": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["key", "label", "type"],
              "properties": {
                "key": { "type": "string" },
                "label": { "type": "string" },
                "type": {
                  "type": "string",
                  "enum": ["string", "text", "number", "money", "int", "date", "datetime", "enum", "bool", "ref", "image", "file"]
                },
                "required": { "type": "boolean", "default": false },
                "unique": { "type": "boolean", "default": false },
                "maxLength": { "type": ["integer", "null"] },
                "default": { "description": "默认值，可为null" },
                "validation": { "type": "string", "description": "校验规则描述，如 手机号格式/金额>=0" },
                "enumValues": {
                  "type": "array",
                  "description": "当type=enum时的具体取值；强制要求列出，不允许留空",
                  "items": { "type": "object", "properties": { "value": {}, "label": { "type": "string" } } }
                },
                "useDict": { "type": "boolean", "description": "是否走若依数据字典", "default": false },
                "ref": { "type": "string", "description": "当type=ref时指向的实体key" }
              }
            }
          },
          "relations": {
            "type": "array",
            "description": "实体间关系",
            "items": {
              "type": "object",
              "properties": {
                "target": { "type": "string", "description": "关联实体key" },
                "type": { "type": "string", "enum": ["one-to-one", "one-to-many", "many-to-many"] },
                "onDelete": { "type": "string", "enum": ["restrict", "cascade", "setNull", "softDelete"], "description": "目标被删时本实体如何处理；必须显式声明" }
              }
            }
          },
          "states": {
            "type": "array",
            "description": "若该实体有状态机，列出状态与流转",
            "items": {
              "type": "object",
              "properties": {
                "value": { "type": "string" },
                "label": { "type": "string" },
                "transitions": {
                  "type": "array",
                  "items": { "type": "object", "properties": { "to": { "type": "string" }, "byRole": { "type": "array", "items": { "type": "string" } }, "condition": { "type": "string" } } }
                }
              }
            }
          }
        }
      }
    },
    "screens": {
      "type": "array",
      "description": "页面",
      "items": {
        "type": "object",
        "required": ["key", "label", "kind"],
        "properties": {
          "key": { "type": "string" },
          "label": { "type": "string" },
          "kind": { "type": "string", "enum": ["dashboard", "list", "detail", "form", "wizard", "auth", "onboarding"], "description": "页面类型，决定必备状态与动作" },
          "entity": { "type": "string", "description": "主实体key，可空" },
          "actions": {
            "type": "array",
            "description": "页面上的可操作动作（按钮/手势等）",
            "items": {
              "type": "object",
              "properties": {
                "key": { "type": "string" },
                "label": { "type": "string" },
                "trigger": { "type": "string", "description": "如 点击/下拉/上拉/长按" },
                "result": { "type": "string", "description": "动作结果：跳转目标/弹窗/提交/toast等" },
                "confirm": { "type": "boolean", "description": "是否需要二次确认（删除/不可逆操作）" }
              }
            }
          },
          "states": {
            "type": "array",
            "description": "页面需声明的状态；阶段1会按kind自动补默认值",
            "items": { "type": "string", "enum": ["empty", "loading", "error", "noPermission", "noResult", "firstUse"] }
          }
        }
      }
    },
    "navigation": {
      "type": "object",
      "properties": {
        "pattern": { "type": "string", "description": "如 底部TabBar+堆栈导航" },
        "tabs": { "type": "array", "items": { "type": "string", "description": "screen key" } },
        "transitions": {
          "type": "array",
          "description": "页面跳转关系，含返回路径",
          "items": { "type": "object", "properties": { "from": { "type": "string" }, "to": { "type": "string" }, "trigger": { "type": "string" }, "back": { "type": "boolean", "description": "是否提供返回" } } }
        }
      }
    },
    "roles": {
      "type": "array",
      "description": "角色与权限；映射若依RBAC+数据权限",
      "items": {
        "type": "object",
        "properties": {
          "key": { "type": "string" },
          "label": { "type": "string" },
          "screenAccess": { "type": "array", "items": { "type": "string" }, "description": "可访问的screen key" },
          "dataScope": { "type": "string", "enum": ["all", "dept", "deptAndChild", "self", "custom"], "description": "数据权限范围，对齐若依" }
        }
      }
    },
    "flows": {
      "type": "array",
      "description": "业务流程；用于流程闭环检查",
      "items": {
        "type": "object",
        "properties": {
          "key": { "type": "string" },
          "label": { "type": "string" },
          "steps": { "type": "array", "items": { "type": "string" } },
          "start": { "type": "string" },
          "successEnd": { "type": "string" },
          "exceptionBranches": { "type": "array", "items": { "type": "string" }, "description": "异常分支，常被遗漏，需重点补" }
        }
      }
    }
  }
}
```

---

## 2. 补全分类法（CHECKLIST，阶段2/3 逐项扫描的对象）

这是整套方案里复用率最高、价值最高的配置。建议作为平台常量维护，提示词里以变量 `{{checklist}}` 注入，而不是写死在提示词文本中——这样升级分类法不必改提示词。

```json
{
  "checklist": [
    { "code": "DATA",    "name": "数据维度",   "items": [
      "每个字段是否定义了类型/必填/长度/默认值/唯一性/校验规则",
      "type=enum的字段是否列出了具体取值（如分级有哪几档、状态有哪些值）",
      "字段间关联与级联是否声明",
      "是否提供了初始示例数据/占位数据"
    ]},
    { "code": "STATE",   "name": "页面状态",   "items": [
      "空状态（无数据时显示什么）",
      "加载中状态",
      "加载失败/网络异常状态及重试",
      "无权限状态",
      "搜索/筛选无结果状态",
      "首次使用引导"
    ]},
    { "code": "ACTION",  "name": "操作与入口", "items": [
      "列表的搜索/筛选/排序/分页/批量操作/导出",
      "卡片与行的增/删/改/查入口是否齐全",
      "删除及不可逆操作是否有二次确认",
      "表单的保存/取消/重置逻辑"
    ]},
    { "code": "FEEDBACK","name": "操作反馈",   "items": [
      "表单字段级校验提示",
      "提交成功的反馈（toast/跳转）",
      "提交失败的错误反馈",
      "操作后的页面状态更新或跳转"
    ]},
    { "code": "FLOW",    "name": "流程闭环",   "items": [
      "每个流程是否有明确起点与正常终点",
      "每个流程的异常分支是否覆盖",
      "状态机流转是否完整（A如何到B，谁能改，条件是什么）",
      "每个跳转是否有返回路径"
    ]},
    { "code": "PERM",    "name": "权限角色",   "items": [
      "不同角色可见/可操作的页面与按钮范围",
      "数据权限（只看自己负责的，还是全部/本部门）",
      "无权限时的兜底表现"
    ]},
    { "code": "EDGE",    "name": "边界异常",   "items": [
      "空值/超长输入/非法输入处理",
      "重复提交/并发编辑处理",
      "删除有关联数据时的处理（禁止删/级联删/软删）",
      "分页到底、列表为空、极端数量"
    ]},
    { "code": "CONSIST", "name": "一致性",     "items": [
      "术语/字段名/交互模式在各页面是否统一",
      "同类页面（多个列表/多个表单）行为是否一致"
    ]}
  ]
}
```

---

## 3. 应用原型库（ARCHETYPE，提升召回率的核心杠杆）

原理：先判断"这是哪类应用"，再从原型库直接拉出"这类应用几乎必有、但用户想不到"的需求。这是模式匹配，远比让模型从零想象可靠。下面给出 **CRM 原型** 的完整模板；平台应为每个原型沉淀一份同结构模板（进销存、任务、预约……），后续只需扩充库，不需改提示词。

```json
{
  "archetype": "CRM",
  "label": "轻量客户关系管理",
  "matchSignals": ["客户", "客户分级", "跟进", "项目/商机", "联系人", "重点客户进展"],
  "impliedEntities": [
    { "key": "followup", "label": "跟进记录", "reason": "CRM核心是跟进过程，几乎必有跟进记录实体（时间/方式/内容/下次跟进时间）" },
    { "key": "contact",  "label": "联系人",   "reason": "一个客户常有多个联系人，独立实体优于单字段" }
  ],
  "impliedRequirements": [
    { "category": "ACTION",  "gap": "客户去重/查重",        "suggestion": "新增客户时按名称或电话查重，命中时提示已存在", "confidence": 0.8 },
    { "category": "FLOW",    "gap": "客户负责人/分配",       "suggestion": "客户可分配负责人，支持转移；与数据权限联动", "confidence": 0.85 },
    { "category": "PERM",    "gap": "数据权限隔离",          "suggestion": "销售只看自己负责的客户，主管看本部门，对齐若依dataScope", "confidence": 0.9 },
    { "category": "ACTION",  "gap": "跟进提醒/待办",          "suggestion": "跟进记录可设下次跟进时间，到期进入今日任务/提醒", "confidence": 0.8 },
    { "category": "DATA",    "gap": "客户分级字典化",         "suggestion": "客户分级走数据字典（如 A/B/C 重要/普通/潜在），可后台维护", "confidence": 0.85 },
    { "category": "FLOW",    "gap": "项目/商机状态机",        "suggestion": "项目进展状态需明确取值与流转（如 接洽→报价→成交/流失），并限定谁可改", "confidence": 0.85 },
    { "category": "STATE",   "gap": "各列表空状态",           "suggestion": "客户列表/项目列表/今日任务为空时均需空状态+引导按钮", "confidence": 0.9 },
    { "category": "ACTION",  "gap": "客户搜索与多条件筛选",    "suggestion": "按名称搜索，按分级/创建时间/负责人筛选", "confidence": 0.85 },
    { "category": "EDGE",    "gap": "删除客户的关联处理",      "suggestion": "客户下有项目/跟进记录时，禁止直接删除或改为软删", "confidence": 0.85 },
    { "category": "ACTION",  "gap": "客户/项目导出",          "suggestion": "支持导出Excel，若依原生能力，建议默认提供", "confidence": 0.7 },
    { "category": "DATA",    "gap": "项目金额校验",           "suggestion": "金额需>=0、限定小数位、超大值提示", "confidence": 0.8 },
    { "category": "FEEDBACK","gap": "保存/删除反馈",          "suggestion": "项目详情保存成功toast并返回，删除需二次确认", "confidence": 0.85 }
  ]
}
```

> 扩展指引：为每个新原型复制本结构。`matchSignals` 用于阶段0自动识别原型；`impliedEntities`/`impliedRequirements` 在阶段2作为候选直接喂给模型核对，命中即补。

---

## 4. 若依能力锚定清单（RUOYI_CAPS，"补得多"且"补得实"）

后台是若依，它的能力面就是一张现成的"免费功能清单"。阶段4用它判断每条补全能否落地（`ruoyi_supported`），同时它本身就是补全候选——很多用户想不到但几乎都要的功能在这里。

```json
{
  "ruoyiCapabilities": [
    { "cap": "CRUD",         "desc": "增删改查+分页列表查询", "promptAs": "标配，无需特别说明" },
    { "cap": "dictionary",   "desc": "数据字典", "promptAs": "所有枚举字段建议走字典，后台可维护取值" },
    { "cap": "excelImport",  "desc": "Excel导入", "promptAs": "对主数据实体提示是否需要批量导入" },
    { "cap": "excelExport",  "desc": "Excel导出", "promptAs": "对列表页提示是否需要导出" },
    { "cap": "rbac",         "desc": "角色权限", "promptAs": "按钮级/菜单级权限控制" },
    { "cap": "dataScope",    "desc": "数据权限", "promptAs": "全部/本部门/本部门及子/仅本人/自定义" },
    { "cap": "deptUser",     "desc": "部门与用户管理", "promptAs": "负责人/归属部门字段可直接复用" },
    { "cap": "operLog",      "desc": "操作日志", "promptAs": "关键操作可自动留痕" },
    { "cap": "fileUpload",   "desc": "文件/图片上传", "promptAs": "附件、头像、合同等" },
    { "cap": "scheduledJob", "desc": "定时任务", "promptAs": "到期提醒、定时统计等" }
  ],
  "notSupportedHint": "复杂实时协作、重度图形编辑、强事务分布式流程等超出若依常规范围，需标记 ruoyi_supported=false 并说明"
}
```

---

## 5. 各阶段提示词

### 阶段0 — 建模（散文需求 → IR）

```
# 角色
你是资深B端系统分析师。将下面非技术用户提供的需求，转换为严格符合给定Schema的结构化应用方案(IR)。

# 输入
原始需求（30题采集结果）：
{{raw_requirements}}

# IR Schema
{{ir_schema}}

# 原型识别信号（用于判定archetype）
{{archetype_match_signals}}

# 要求
1. 先依据matchSignals判定最贴近的archetype，无匹配填"通用"。
2. 抽取所有数据实体及字段；无法确定的属性（类型/必填等）按最合理默认填写，不要遗漏字段。
3. 对所有枚举字段，即使原文未给取值，也要给出合理的候选enumValues。
4. 识别页面及其kind；为每个list/detail/form页面至少声明主实体。
5. 还原导航与跳转关系，每个跳转标注是否有返回。
6. 识别角色；若原文未提，至少给出一个默认角色并标dataScope。
7. 仅做忠实建模，不在此阶段补全缺口（补全在后续阶段）。

# 输出
仅输出符合Schema的JSON，不要任何解释、注释或Markdown代码围栏。
```

> few-shot 建议：在 `{{ir_schema}}` 之后附 1 个完整的"输入散文 → 输出 IR" 示例，对召回质量提升明显。

### 阶段1 — 派生式补全（规则代码，不调模型）

不是提示词，是编排层规则。伪代码：

```
for entity in IR.entities:
    生成标准页面: list / detail / form（若缺）
    for field in entity.fields:
        if type==enum and enumValues为空: 标记缺口 DATA
        if required未声明: 默认false
    for relation in entity.relations:
        if onDelete未声明: 标记缺口 EDGE（删除关联处理）

for screen in IR.screens:
    按 kind 强制补必备 states:
        list  -> [empty, loading, error, noResult]
        detail-> [loading, error, noPermission]
        form  -> [error]
        dashboard -> [empty, loading]
    for action in screen.actions:
        if 不可逆动作(删除/清空) and confirm!=true: 标记缺口 ACTION（二次确认）

注入原型 impliedEntities：若原型建议的实体不在IR中，作为候选缺口加入。
```

派生出的"硬性必备项"召回率100%，无需模型参与。

### 阶段2 — 清单驱动扫描（模型主力）

```
# 角色
你是资深B端产品经理，审查一个由非技术用户描述、即将被自动生成的应用方案，
找出方案中遗漏的、但应用正常运行所必需的需求。

# 输入
应用结构化方案(IR)：
{{ir_json}}

应用原型及其隐含需求库：
{{archetype_template}}

补全检查清单：
{{checklist}}

# 任务
对清单中每一类(code)的每一条item，针对IR里每个相关的实体/页面/流程，
判断当前方案是否已覆盖。未覆盖则输出一条补全建议。
同时核对原型库 impliedRequirements，IR未覆盖的命中项一并输出。

# 约束
- 只补"应用正常运行所必需"的需求，不发明用户明显不需要的功能。
- 每条建议必须可追溯：注明从哪个实体/页面/流程/原型规律推导而来。
- 不重复输出已在IR中明确存在的内容。

# 输出（严格JSON数组，无任何额外文字）
[
  {
    "category": "STATE",
    "target": "客户列表页",
    "gap": "未定义无数据时的空状态",
    "suggestion": "客户列表为空时显示空状态插画 + '新增第一个客户'按钮",
    "rationale": "list类页面必有空状态；当前IR的screens[customer_list].states未声明empty",
    "confidence": 0.9
  }
]
```

### 阶段3 — 多角色评审（同输入，多视角，结果合并去重）

复用阶段2的输入与输出格式，仅替换"角色"段，按下列角色各跑一次：

```
[交互设计师] 你是交互设计师，从"用户在这个界面会卡在哪、会困惑什么、手势/反馈是否缺失"的角度找缺口。
[QA测试]    你是QA测试工程师，从"用户会怎样把这个功能用坏"的角度找缺口：异常输入、重复提交、并发、极端数据、删除关联数据。
[真实用户]   你是第一次使用该应用的真实业务用户，凭直觉指出"我以为能做却做不了""我不知道点了会怎样"的地方。
[运维/管理]  你是后台管理员，从"枚举值/字典/权限/导出/日志这些后台可维护项是否齐全"的角度找缺口。
```

编排层将各角色的 gap[] 合并，按 `target+gap` 语义去重（可用模型或规则）。

### 阶段4 — 一致性 + 可实现性校验

```
# 角色
你是技术负责人，对补全建议做两件事：一致性检查 与 若依可实现性标注。

# 输入
IR：{{ir_json}}
合并后的补全建议：{{merged_gaps}}
若依能力清单：{{ruoyi_caps}}

# 任务
1. 一致性：扫描IR中术语/字段名/交互模式在各页面是否冲突或不统一，发现则新增CONSIST类缺口。
2. 可实现性：为每条补全建议补充 ruoyi_supported(true/false) 与 ruoyi_cap(命中的能力code)；
   若false，在note中说明原因与替代方案。
3. 主动补：依据若依能力清单的promptAs，对相关实体/列表追加"用户想不到但若依易实现"的候选（如导出、字典化、数据权限），confidence酌情。

# 输出
在原gap结构基础上补充字段后的JSON数组：
{ ...原字段, "ruoyi_supported": true, "ruoyi_cap": "excelExport", "note": "" }
```

### 阶段5 — 收敛为采纳卡片（可含规则+轻量模型）

```
# 任务
将所有补全建议整理为前端可直接渲染的采纳卡片列表：
1. 去重合并语义重复项，相似项保留confidence更高者。
2. 排序：先按category分组(顺序 DATA,STATE,ACTION,FEEDBACK,FLOW,PERM,EDGE,CONSIST)，组内按confidence降序。
3. 默认勾选规则：派生类(来自阶段1)与若依标配类 + confidence>=0.85 → defaultAccepted=true；其余false。
4. 每条生成一句给非技术用户看的人话说明(plainText)，避免术语。

# 输出（前端渲染用）
[
  {
    "id": "gap_001",
    "category": "状态",
    "target": "客户列表页",
    "title": "为空时显示空状态和新增按钮",
    "plainText": "当还没有任何客户时，页面会显示提示和一个'新增客户'按钮，避免一片空白。",
    "rationale": "列表类页面必备空状态",
    "confidence": 0.9,
    "ruoyi_supported": true,
    "defaultAccepted": true
  }
]
```

---

## 6. 采纳卡片 → 回写 IR

用户在界面逐条"采纳/忽略"（即截图中"已采纳"交互）。编排层将被采纳卡片按 `category`/`target` 合并回 IR：状态类补进 `screens[].states`；动作类补进 `screens[].actions`；字典/校验补进 `entities[].fields`；权限补进 `roles[]`；流程异常分支补进 `flows[].exceptionBranches`。回写后的 IR 即为代码生成的最终输入。

建议给每张卡片保留 `rationale` 与 `confidence` 的悬浮提示，并设阈值（如默认只展开 confidence>=0.6 的项），避免一次甩出几十条把用户淹没——补得多之后真正的风险是补过头。

---

## 7. 集成说明（给编排层工程师）

1. 将第2节 `checklist`、第3节各原型模板、第4节 `ruoyiCapabilities` 作为平台常量/配置表维护，提示词中以变量注入，便于独立升级。
2. 调用顺序见第0节流水线。阶段1为纯规则；阶段2/3/4/5调模型。阶段3的多次调用可并行。
3. 所有模型调用强制 JSON 输出；解析前去除可能的 ```json 围栏并 try/catch，失败则按"该阶段无新增缺口"降级，不阻断主流程。
4. 召回率优化优先级：① 扩充原型库 > ② 完善分类法 > ③ 增加阶段3角色 > ④ 打磨提示词措辞。把精力投在前两项收益最大。
5. 与若依集成的后台开发问题不在本工具包范围；本工具包只负责把需求补全并标注可实现性，最终落地由代码生成层对接若依完成。

---

## 附：最小可跑闭环（如先做MVP）

只实现 阶段0 + 阶段1 + 阶段2 + 阶段5 即可上线见效；阶段3、4作为第二步增强。第一版原型库只需做你当前主打的1个原型（如CRM），跑通后再扩。
