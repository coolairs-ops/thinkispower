/**
 * 上线门（ADR-0009）——确定性二值合取，焊死在"真编译过 + 真起来 + 真探活"上。
 *
 * 只有交付程序**真能跑**才置 `completed`(=真上线)；空跑/未验证一律不当"通过"。
 * 头号风险是假阳性（把跑不起来的标成已上线）——宁可显示"未验证/失败"，不可假装通过。
 *
 * 纯函数、确定性、零副作用——决策逻辑可单测，与"真起后端/真探活"的副作用执行解耦。
 */

export type DeliveryStatus = 'completed' | 'build_failed' | 'contract_violation' | 'smoke_failed' | 'deploy_failed' | 'preview_only';
export type DeployResultStatus = 'deployed' | 'static_only' | 'deploy_failed' | 'not_deployed';

export interface DeliveryGateInput {
  /** D2：交付代码真编译过没（npx tsc） */
  compilationPassed: boolean;
  /** D3：契约一致——前端 appData 调的资源 ⊆ 后端真契约。false=越界(上线必 404)；undefined=无契约可查、不拦 */
  contractConformant?: boolean;
  /** D4：部署结果——deployed=容器真起来并健康；static_only=Docker不可用降级；其余=失败 */
  deployStatus: DeployResultStatus;
  /** deployStatus==='deployed' 时的真实可访问 URL */
  deployedUrl?: string;
  /** 冒烟结果：**仅在真起后端(deployed)后**打真端点跑出；undefined=未起后端、未验证（不当通过也不当失败） */
  smokePassed?: boolean;
  /** D6：若依后端是否真就绪（已置备 + 探活过）——路-若依项目的"真起来+真探活"证据 */
  backendReady?: boolean;
  /** 降级静态托管 URL（仅预览用，非上线 URL） */
  staticUrl: string;
}

export interface DeliveryOutcome {
  status: DeliveryStatus;
  /** 仅 completed 给真实上线 URL；preview_only 给静态预览 URL；失败态给 null */
  productionUrl: string | null;
  reason: string;
}

/**
 * 判定交付结局。确定性二值合取：编译门 ∧ 运行时真证据(部署健康 或 后端就绪) ∧ 冒烟不为假。
 */
export function decideDeliveryOutcome(i: DeliveryGateInput): DeliveryOutcome {
  // ── D2 编译门：编译不过，绝不上线 ──
  if (!i.compilationPassed) {
    return { status: 'build_failed', productionUrl: null, reason: '编译未通过，不予上线' };
  }

  // ── D3 契约门：前端调了后端不存在的资源 → 上线必 404，不予上线 ──
  if (i.contractConformant === false) {
    return { status: 'contract_violation', productionUrl: null, reason: '前端 appData 调用越界后端真契约（上线必 404）' };
  }

  // ── 运行时真证据①：容器真部署起来并健康 ──
  if (i.deployStatus === 'deployed' && i.deployedUrl) {
    // 真起来后才有"冒烟"这回事：冒烟明确失败 → 不上线；通过或未覆盖 → 上线
    if (i.smokePassed === false) {
      return { status: 'smoke_failed', productionUrl: null, reason: '已部署但冒烟测试未通过' };
    }
    return {
      status: 'completed',
      productionUrl: i.deployedUrl,
      reason: i.smokePassed ? '编译 + 部署健康 + 冒烟通过' : '编译 + 部署健康（冒烟未覆盖端点）',
    };
  }

  // ── 运行时真证据②：若依后端真就绪（前端交付 + 真后端在跑） ──
  if (i.backendReady) {
    return { status: 'completed', productionUrl: i.staticUrl, reason: '前端交付 + 若依后端已就绪' };
  }

  // ── 非 completed：诚实置态，绝不假阳性 ──
  if (i.deployStatus === 'static_only') {
    // Docker 不可用降级：只有静态前端、没有在跑的后端 → 仅预览，明确"未上线"
    return { status: 'preview_only', productionUrl: i.staticUrl, reason: 'Docker 不可用，仅静态预览·未上线' };
  }
  return { status: 'deploy_failed', productionUrl: null, reason: '部署未成功且后端未就绪，不予上线' };
}
