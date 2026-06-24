/**
 * 把 demo HTML 压成"可判定语义"再喂 LLM 验证器（TraceabilityValidator / CrossValidator / 验收 judge 共用）。
 *
 * 剥掉 `<style>` 主题/CSS 噪声（对"功能是否实现"判定无意义、白占预算），上限放宽到覆盖多页 demo。
 * 保留 HTML 结构 + `<script>`（appData 绑定是"接口存在"的证据）。
 *
 * 病灶：原各 validator 各自 slice(0,12000/15000)，长 demo(本例 24K 字)靠后的页整段被截 →
 * 后半页(如多页 demo 的聊天/咨询页,本例聊天页在第 15038 字)被假判未实现/待人工。差 38 字就报"无聊天界面"。
 */
export function condenseHtmlForJudge(html: string, cap = 36000): string {
  return (html ?? '').replace(/<style[\s\S]*?<\/style>/gi, '').slice(0, cap);
}
