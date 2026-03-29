# Telegram Channel 完善修复

**Date:** 2026-03-29
**Status:** Approved

## Problem

Telegram 通道虽然已实现，但存在阻塞性和功能性问题导致无法实际使用。

## Fixes

### Fix 1: Web UI 动态通道表单 (ChannelManagePanel.tsx)

**当前问题：** 下拉菜单只有 WeCom，表单字段硬编码为 WeCom 的 botId/secret。

**修复：**
- 组件挂载时调用 `channel.discover-plugins` 获取可用插件列表
- 下拉菜单从插件列表动态填充（WeCom、Telegram 等）
- 根据选中的 channelName 动态渲染凭证字段，使用配置映射表：
  ```typescript
  const CHANNEL_FIELDS: Record<string, Array<{ key: string; label: string; required: boolean; type: string }>> = {
    wecom: [
      { key: 'corpId', label: 'Corp ID', required: true, type: 'text' },
      { key: 'agentId', label: 'Agent ID', required: true, type: 'text' },
      { key: 'secret', label: 'Secret', required: true, type: 'password' },
    ],
    telegram: [
      { key: 'botToken', label: 'Bot Token', required: true, type: 'password' },
      { key: 'webhookUrl', label: 'Webhook URL', required: false, type: 'text' },
      { key: 'webhookSecret', label: 'Webhook Secret', required: false, type: 'password' },
    ],
  };
  ```
- 未知通道类型 fallback 为通用 key-value 表单

### Fix 2: Server 依赖声明 (packages/server/package.json)

**当前问题：** `openlobby-channel-telegram` 未声明为 server 的依赖，运行时 dynamic import 会失败。

**修复：** 在 `optionalDependencies` 中添加 `openlobby-channel-telegram: "workspace:*"`。使用 optional 而非 dependencies 是因为不是所有用户都需要 Telegram。

### Fix 3: 审批按钮布局 (telegram-provider.ts)

**当前问题：** `sendApprovalCard` 中每个按钮独占一行（垂直排列），问答卡片 UI 差。

**修复：** 改为将选项按钮放在同一行，特殊按钮（✅ 确认、允许/拒绝）单独一行：
```typescript
// 选项按钮横排（一行最多 3 个，超出换行）
const optionRows: Array<Array<InlineButton>> = [];
for (let i = 0; i < actions.length; i += 3) {
  optionRows.push(actions.slice(i, i + 3).map(a => ({ text: a.label, callback_data: a.callbackData })));
}
inline_keyboard: optionRows
```

### Fix 4: Webhook 模式 healthy 状态 (telegram-provider.ts)

**当前问题：** Webhook 注册成功后没有设置 `this.healthy = true`。

**修复：** 在 `setWebhook` 成功后添加 `this.healthy = true`。

### Fix 5: updateCard taskId 映射 (telegram-provider.ts)

**当前问题：** `updateCard` 期望 `chatId:messageId` 格式，但 channel-router 传入的 taskId 是 `ap_xxx` 随机字符串，且发送审批卡片时未存储 message_id。

**修复：**
- 在 `TelegramBotProvider` 中新增 `private approvalMessageIds = new Map<string, { chatId: string; messageId: number }>()`
- `sendApprovalCard` 发送成功后，从 actions 的 callbackData 中提取 taskId，存储 `{ chatId, messageId }` 映射
- `updateCard` 通过 taskId 查找真实的 chatId 和 messageId
- 映射 5 分钟后自动清理

### Fix 6: Typing timer key 类型统一 (telegram-provider.ts)

**当前问题：** chatId 有时是 number 有时是 string，导致 Map key 不一致。

**修复：** 所有 typingTimers 的 key 统一转为 `String(chatId)`。

## Files to Modify

| File | Change |
|------|--------|
| `packages/web/src/components/ChannelManagePanel.tsx` | 动态通道类型下拉 + 动态表单字段 |
| `packages/server/package.json` | 添加 telegram 为 optionalDependencies |
| `packages/channel-telegram/src/telegram-provider.ts` | 按钮布局、webhook healthy、updateCard 映射、typing key |
