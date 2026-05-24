/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 放弃声明（Roll Cancellation）派生工具 — 详见 .docs/roll-cancellation.md
 *
 * 核心铁律：是否放弃由"keeper 消息是否仍是 messages 队尾"派生，
 * 不在 ChatMessage 上新增任何 _consumed / _cancelled 字段。
 */

import type { ChatMessage } from "../types";

/**
 * 一条 keeper 消息上的 rollRequest 是否仍处于"活跃"态（玩家仍可点 D100 投骰）。
 *
 * 当且仅当三件事同时成立：
 *   1. 该消息是 keeper 消息
 *   2. 持有 rollRequest 字段
 *   3. **它仍是 messages 数组的最后一条**
 *
 * 任何后续消息（player / system / keeper）都会让其变为 false → 卡片视为已放弃。
 */
export function isLatestKeeperRollRequest(
  message: ChatMessage,
  messages: ChatMessage[],
): boolean {
  if (message.sender !== "keeper") return false;
  if (!message.parsedResponse?.rollRequest) return false;
  return messages[messages.length - 1]?.id === message.id;
}

/**
 * 在"即将追加新消息"前调用：若当前 messages 队尾是带未消费 rollRequest 的 keeper
 * 消息，返回该消息（用于拼接 [放弃声明] system 标记）；否则返回 null。
 *
 * 注意调用时机——必须在追加新消息**之前**调用，因为追加之后队尾就不是它了。
 */
export function findPendingTailRollRequest(
  messages: ChatMessage[],
): ChatMessage | null {
  if (messages.length === 0) return null;
  const tail = messages[messages.length - 1];
  if (tail.sender !== "keeper") return null;
  if (!tail.parsedResponse?.rollRequest) return null;
  return tail;
}

/**
 * 拼装 [放弃声明] system 标记文本（与 [[fate-gamble]] / [[two-stage-roll]] 同机制）。
 * 调用方应将该文本作为 isSystemReport=true 的消息追加进 messages，与玩家新消息
 * 合并进入同一次 LLM 调用上下文。
 */
export function buildCancellationReport(
  skillName: string,
  reason: string,
): string {
  return `[放弃声明] 玩家撤回了"${skillName}"判定声明（reason: "${reason}"）。请按真实 KP 反应处理：通常让该意图自然过去；当撤回的犹豫本身在场景里有意义时（紧迫战斗的喘息、对方 NPC 看到伸手又收回、被追逐时停下脚步），可在 narrative 中让"犹豫"产生后果。**不要**直接重发同一个 rollRequest——除非剧情条件再次主动施加。`;
}

/**
 * 判定一条消息是否是"纯给 LLM 看"的内部 system 标记，对玩家不应可见。
 * 用于聊天 UI 渲染前过滤；这些消息仍会进存档、仍会喂 LLM。
 *
 * 当前覆盖：
 *   - sys_cancel_*  [放弃声明]
 *
 * 未来若想隐藏 sys_dying_gate_*、sys_madness_gate_* 等指令型 system 标记，
 * 在此处追加 id 前缀即可——所有出口共用一份判定。
 */
const INTERNAL_SYSTEM_ID_PREFIXES = ["sys_cancel_"] as const;

export function isInternalSystemMarker(message: ChatMessage): boolean {
  if (message.sender !== "system") return false;
  return INTERNAL_SYSTEM_ID_PREFIXES.some((prefix) => message.id.startsWith(prefix));
}
