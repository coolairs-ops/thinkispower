#!/bin/bash
# ─── 全链路 E2E 测试：从需求到交付 ───
# 用法: bash e2e-test.sh
set -e

BASE="http://localhost:3001/api"
PASS=0
FAIL=0
TIMESTAMP=$(date +%s)
EMAIL="test-${TIMESTAMP}@example.com"
NAME="测试用户 ${TIMESTAMP}"
PASSWORD="test123456"
PROJECT_NAME="个人博客"
TOKEN=""
PID=""

pass() { PASS=$((PASS+1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL+1)); echo "  ❌ $1: $2"; }

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   全链路 E2E 测试 — 从需求到交付              ║"
echo "║   $(date '+%Y-%m-%d %H:%M:%S')                        ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ─── 1. 健康检查 ───
echo "─── 1/8 健康检查 ───"
HEALTH=$(curl -sf "${BASE}/health" 2>&1) && pass "API 健康检查通过" || fail "API 不可达" "$HEALTH"

# ─── 2. 注册用户 ───
echo "─── 2/8 注册用户 ───"
REG=$(curl -sf -X POST "${BASE}/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"name\":\"${NAME}\",\"password\":\"${PASSWORD}\"}" 2>&1) || true
if echo "$REG" | grep -q '"token"'; then
  TOKEN=$(echo "$REG" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])" 2>/dev/null || echo "$REG" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
  pass "注册成功 (${EMAIL})"
else
  # 可能已存在，尝试登录
  REG=$(curl -sf -X POST "${BASE}/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}" 2>&1) || fail "登录失败" "$REG"
  TOKEN=$(echo "$REG" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])" 2>/dev/null || echo "$REG" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
  pass "登录成功"
fi
AUTH="Authorization: Bearer ${TOKEN}"

# ─── 3. 创建项目 ───
echo "─── 3/8 创建项目 ───"
PROJ=$(curl -sf -X POST "${BASE}/projects" \
  -H "${AUTH}" -H "Content-Type: application/json" \
  -d "{\"name\":\"${PROJECT_NAME}\",\"description\":\"一个简洁的个人博客系统\"}" 2>&1)
PID=$(echo "$PROJ" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null || echo "$PROJ" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -n "$PID" ]; then
  pass "项目创建成功 (${PID})"
else
  fail "项目创建失败" "$PROJ"
  echo "无法继续，退出测试"
  exit 1
fi

# ─── 4. 需求澄清（发送产品需求）───
echo "─── 4/8 需求澄清 ───"

send_message() {
  local content="$1"
  curl -sf -X POST "${BASE}/projects/${PID}/messages" \
    -H "${AUTH}" -H "Content-Type: application/json" \
    -d "{\"content\":\"${content}\"}" 2>&1
}

# 第一次发送详细需求
RESP=$(send_message "我想做一个个人博客网站。目标用户是我这样的技术写作者，平时写一些技术文章和笔记，希望能有个地方发布和分享。核心功能包括：1) 文章管理 — 写文章、编辑、发布、草稿保存；2) 分类标签 — 给文章打标签和分类；3) 读者评论 — 读者可以评论文章；4) 关于页面 — 一个简单的个人介绍页。我希望风格简洁干净，类似 Medium 的阅读体验。不需要用户注册登录（我自己管理后台即可），也不需要多作者。第一版先上线核心功能就好。")
echo "$RESP" | python3 -c "
import sys, json
data = json.load(sys.stdin)
msgs = data.get('messages', [])
if msgs:
    last = msgs[-1]
    role = last.get('role','')
    content = last.get('content','')
    print(f'  🤖 AI 回复 ({role}): {content[:200]}')
" 2>/dev/null || echo "  (解析回复)"

# 检查是否 PRD 就绪了
PRJ=$(curl -sf "${BASE}/projects/${PID}" -H "${AUTH}" 2>&1)
STATUS=$(echo "$PRJ" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")
echo "  项目状态: ${STATUS:-UNKNOWN}"

# 如果还需要追问，做几轮简单回答
ROUND=0
while [ "$STATUS" != "prd_ready" ] && [ "$STATUS" != "plan_ready" ] && [ $ROUND -lt 8 ]; do
  ROUND=$((ROUND+1))
  echo "  --- 追问轮次 $ROUND ---"

  # 从最新消息提取 AI 的问题，给出简单回答
  MSGS=$(curl -sf "${BASE}/projects/${PID}/messages" -H "${AUTH}" 2>&1)
  QUESTION=$(echo "$MSGS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
msgs = data.get('messages', [])
for m in reversed(msgs):
    if m.get('role') == 'assistant':
        print(m.get('content','')[:300])
        break
" 2>/dev/null || echo "")

  if echo "$QUESTION" | grep -qiE "(预算|费用|多少钱)"; then
    ANSWER="预算大概 5000 以内吧，主要是能用就行"
  elif echo "$QUESTION" | grep -qiE "(时间|周期|什么时候|多久)"; then
    ANSWER="希望两周内能上线第一版"
  elif echo "$QUESTION" | grep -qiE "(设计|风格|样式|配色|主题)"; then
    ANSWER="简约风格，白底黑字，类似 Medium 的阅读体验"
  elif echo "$QUESTION" | grep -qiE "(后台|管理|admin)"; then
    ANSWER="后台简单点就好，能写文章和管理评论"
  elif echo "$QUESTION" | grep -qiE "(数据库|存储|数据)"; then
    ANSWER="用最简单的方式就行，不需要太复杂"
  elif echo "$QUESTION" | grep -qiE "(部署|上线|服务器|域名)"; then
    ANSWER="能直接部署到网上让大家访问就行"
  elif echo "$QUESTION" | grep -qiE "(评论|互动|社交)"; then
    ANSWER="读者可以匿名评论，我后台审核后显示"
  elif echo "$QUESTION" | grep -qiE "(版本|迭代|后续|未来)"; then
    ANSWER="先做第一版核心功能就好"
  elif echo "$QUESTION" | grep -qiE "(用户|角色|权限|注册|登录)"; then
    ANSWER="就我一个人用后台管理，读者不用登录就能看文章"
  elif echo "$QUESTION" | grep -qiE "(参考|类似|竞品|对比)"; then
    ANSWER="类似 Medium 的风格就好"
  else
    ANSWER="你说的我理解了，按你觉得合理的方式设计就好。"
  fi

  echo "  🧑 回答: ${ANSWER}"
  RESP=$(send_message "$ANSWER")

  # 重新检查状态
  sleep 2
  PRJ=$(curl -sf "${BASE}/projects/${PID}" -H "${AUTH}" 2>&1)
  STATUS=$(echo "$PRJ" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")
  echo "  项目状态: ${STATUS}"
done

if [ "$STATUS" = "prd_ready" ] || [ "$STATUS" = "plan_ready" ]; then
  pass "需求澄清完成，PRD 就绪"
else
  fail "需求澄清未完成" "最终状态: ${STATUS}"
fi

# ─── 5. 方案 ───
echo "─── 5/8 方案确认 ───"
sleep 2

# 获取方案
PLAN=$(curl -sf "${BASE}/projects/${PID}/plan" -H "${AUTH}" 2>&1) || true
PLAN_SUMMARY=$(echo "$PLAN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('summary','') or d.get('summary',''))" 2>/dev/null || echo "（无方案摘要）")
if [ -n "$PLAN_SUMMARY" ]; then
  pass "方案已生成: ${PLAN_SUMMARY:0:100}"
else
  # 方案可能还没生成，等一会儿再试
  echo "  等待方案生成..."
  sleep 5
  PLAN=$(curl -sf "${BASE}/projects/${PID}/plan" -H "${AUTH}" 2>&1) || true
  PLAN_SUMMARY=$(echo "$PLAN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('summary','') or d.get('summary',''))" 2>/dev/null || echo "（无方案摘要）")
  if [ -n "$PLAN_SUMMARY" ]; then
    pass "方案已生成 (延迟): ${PLAN_SUMMARY:0:100}"
  else
    fail "方案未生成" "plan API 返回: $(echo $PLAN | head -c 200)"
  fi
fi

# 设计方案建议
DESIGN=$(curl -sf "${BASE}/projects/${PID}/plan/design-suggestions" -H "${AUTH}" 2>&1) || true
echo "  🎨 设计建议: $(echo $DESIGN | python3 -c "import sys,json; d=json.load(sys.stdin); print(str(d)[:200])" 2>/dev/null || echo 'N/A')"

# 确认方案
CONF=$(curl -sf -X PUT "${BASE}/projects/${PID}/plan/confirm" -H "${AUTH}" -H "Content-Type: application/json" 2>&1) || true
if echo "$CONF" | grep -qE '"statusCode"|error'; then
  fail "方案确认失败" "$(echo $CONF | head -c 200)"
else
  pass "方案已确认"
fi

# ─── 6. Demo 生成 ───
echo "─── 6/8 Demo 生成 ───"
echo "  开始生成 Demo..."
DEMO=$(curl -sf -X POST "${BASE}/projects/${PID}/demo/generate" -H "${AUTH}" -H "Content-Type: application/json" 2>&1) || true

if echo "$DEMO" | grep -qE '"statusCode"|error'; then
  fail "Demo 生成失败" "$(echo $DEMO | head -c 200)"
else
  # 等待 demo 生成完成
  echo "  等待 Demo 生成..."
  DEMO_READY=false
  for i in 1 2 3 4 5; do
    sleep 3
    DEMO_HTML=$(curl -sf "${BASE}/projects/${PID}/demo" -H "${AUTH}" 2>&1) || true
    HTML_LEN=$(echo "$DEMO_HTML" | python3 -c "import sys; d=sys.stdin.read(); print(len(d))" 2>/dev/null || echo "0")
    if [ "$HTML_LEN" -gt 100 ] 2>/dev/null; then
      DEMO_READY=true
      break
    fi
    echo "  等待中... (第${i}次检查, 长度=${HTML_LEN})"
  done
  if $DEMO_READY; then
    pass "Demo 生成成功 (${HTML_LEN} bytes)"
  else
    fail "Demo 生成超时" "最终 HTML 长度: ${HTML_LEN}"
  fi
fi

# ─── 7. 自迭代评估 ───
echo "─── 7/8 自迭代评估 ───"

# 启动
START=$(curl -sf -X POST "${BASE}/projects/${PID}/delivery/auto-iterate/start" \
  -H "${AUTH}" -H "Content-Type: application/json" 2>&1) || true
TASK_ID=$(echo "$START" | python3 -c "import sys,json; print(json.load(sys.stdin).get('taskId',''))" 2>/dev/null || echo "")

if [ -z "$TASK_ID" ]; then
  fail "自迭代启动失败" "$(echo $START | head -c 200)"
else
  pass "自迭代已启动 (taskId: ${TASK_ID})"
  echo "  监控迭代进度 (最多等 180 秒)..."

  # SSE 监控：用 curl 连 SSE 读事件
  SSE_URL="http://localhost:3001/api/projects/${PID}/delivery/auto-iterate/stream/${TASK_ID}?token=${TOKEN}"
  LAST_STATUS=""
  ROUNDS_DONE=0
  FINAL_SCORE=0

  # 启动后台 SSE 监听（最多 180 秒超时）
  SSE_OUT=$(mktemp)
  curl -sf --max-time 180 "$SSE_URL" 2>&1 > "$SSE_OUT" &
  SSE_PID=$!

  # 每 5 秒检查状态直到完成
  MONITOR_START=$(date +%s)
  while true; do
    NOW=$(date +%s)
    ELAPSED=$((NOW - MONITOR_START))
    if [ $ELAPSED -gt 180 ]; then
      echo "  ⏰ 监控超时 (180s)"
      break
    fi

    # 检查 SSE 输出
    if [ -s "$SSE_OUT" ]; then
      LAST_LINE=$(tail -1 "$SSE_OUT")
      if echo "$LAST_LINE" | grep -q "round_result"; then
        ROUNDS_DONE=$((ROUNDS_DONE + 1))
        SCORE=$(echo "$LAST_LINE" | grep -oP '"overallScore":\d+' | cut -d: -f2 || echo "?")
        [ -n "$SCORE" ] && FINAL_SCORE=$SCORE
        echo "  第 ${ROUNDS_DONE} 轮完成 — 评分 ${FINAL_SCORE}"
      fi
      if echo "$LAST_LINE" | grep -q '"type":"done"'; then
        echo "  🏁 迭代完成!"
        break
      fi
      if echo "$LAST_LINE" | grep -q '"type":"stuck"'; then
        echo "  ⚠️ 迭代卡住，需要决策"
        break
      fi
      if echo "$LAST_LINE" | grep -q '"type":"error"'; then
        echo "  ❌ 迭代出错"
        break
      fi
    fi

    # 检查状态 API
    STATUS_RES=$(curl -sf "${BASE}/projects/${PID}/delivery/auto-iterate/status" -H "${AUTH}" 2>&1 || echo '{"active":true}')
    ACTIVE=$(echo "$STATUS_RES" | python3 -c "import sys,json; print(json.load(sys.stdin).get('active',True))" 2>/dev/null || echo "true")
    if [ "$ACTIVE" = "false" ]; then
      echo "  状态 API 显示非活跃"
      break
    fi

    sleep 3
  done

  kill $SSE_PID 2>/dev/null || true
  rm -f "$SSE_OUT"

  # 做决策 (accept)
  sleep 2
  DECIDE=$(curl -sf -X POST "${BASE}/projects/${PID}/delivery/auto-iterate/decide" \
    -H "${AUTH}" -H "Content-Type: application/json" \
    -d '{"decision":"accept"}' 2>&1) || true
  if echo "$DECIDE" | grep -qE '"statusCode"|error'; then
    echo "  决策接口返回: $(echo $DECIDE | head -c 100)"
  else
    echo "  ✅ 已采纳迭代结果"
  fi

  if [ $ROUNDS_DONE -gt 0 ]; then
    pass "自迭代完成: ${ROUNDS_DONE} 轮, 最终评分 ${FINAL_SCORE}"
  else
    fail "自迭代未产生有效轮次" "SSE 输出大小: $(wc -c < "$SSE_OUT" 2>/dev/null || echo 0)"
  fi
fi

# ─── 8. 交付状态 ───
echo "─── 8/8 交付检查 ───"

# 检查交付状态
DELIV=$(curl -sf "${BASE}/projects/${PID}/delivery" -H "${AUTH}" 2>&1) || true
DELIV_STATUS=$(echo "$DELIV" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null || echo "")
PUBLIC_URL=$(echo "$DELIV" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('productionUrl','') or 'none')" 2>/dev/null || echo "none")

echo "  交付状态: ${DELIV_STATUS:-N/A}"
echo "  生产 URL: ${PUBLIC_URL}"

# 触发交付分析
EVAL=$(curl -sf -X POST "${BASE}/projects/${PID}/delivery/evaluate" \
  -H "${AUTH}" -H "Content-Type: application/json" 2>&1) || true
if echo "$EVAL" | grep -qE '"statusCode"|error'; then
  fail "交付评估失败" "$(echo $EVAL | head -c 200)"
else
  SCORE=$(echo "$EVAL" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('completeness','?') or d.get('quality','?'))" 2>/dev/null || echo "?")
  pass "交付评估完成 (评分 ${SCORE})"
fi

# 传感器健康检查
SENSOR=$(curl -sf "${BASE}/sensors/health" 2>&1) || true
SENSOR_SCORE=$(echo "$SENSOR" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('score','?'))" 2>/dev/null || echo "?")
echo "  📊 平台传感器健康度: ${SENSOR_SCORE}/100"

# ─── 汇总 ───
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║              测试报告汇总                      ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "  项目: ${PROJECT_NAME} (${PID})"
echo "  用户: ${EMAIL}"
echo "  通过: ${PASS}  |  失败: ${FAIL}"
echo ""
TOTAL=$((PASS + FAIL))
echo "  通过率: $(awk "BEGIN {printf \"%.0f%%\", ${PASS}/${TOTAL}*100}")"
echo ""

# TODO 清理测试用户/项目（保留以便人工检查）
echo "  ℹ️  测试项目保留以便人工检查，可手动删除:"
echo "     curl -X DELETE ${BASE}/projects/${PID} -H \"${AUTH}\""
echo ""

exit $FAIL
