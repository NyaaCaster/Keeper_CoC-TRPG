# Prompt Architecture Optimization Plan

> Created: 2026-06-10
> Purpose: Track the Keeper prompt architecture optimization against the NyaaChat LLM prompt layout/cache standard.

## Resume Instruction

If Codex or the terminal session is interrupted, start the next conversation with:

```text
继续 Keeper_CoC-TRPG 的 prompt 架构优化。请先阅读 .docs/.work/prompt-architecture-optimization-plan.md 和 .docs/.work/PROJECT-OVERVIEW.md，然后从计划中第一个未完成项继续执行。掷骰/MCP 运行链路不得改动。
```

Before making further edits, re-check the current git diff and this file's checklist. Do not assume prior in-memory context survived.

## Scope

Goal: reshape LLM request construction into:

1. Static system prefix
2. Stable real conversation history
3. Latest user message
4. Dynamic tail rules / user-injected fallback block

Expected benefits:

- Better prompt-cache behavior in long scenario-based sessions.
- Stronger recency for current scene, inventory, terminal state, and madness constraints.
- Cleaner trust boundary for any future external/RAG/tool text.

## Hard Boundaries

- Do not change MCP dice APIs or random source behavior.
- Do not change dice result calculation, success ranking, bonus/penalty, luck burn, pushed roll, SAN loss, keeperRoll, or effect-roll settlement semantics.
- Do not move dice authority to the LLM. The LLM may only narrate already-settled dice results.
- Prompt placement can change for dice reports and system markers, but runtime behavior must remain equivalent.

## Current Findings

- Main Keeper dispatch is assembled in `src/App.tsx` around `triggerKeeperNarration`.
- `systemInstruction` currently includes static prompt plus dynamic instructions, element toggles, combat stats, inventory, and scenario block.
- `userText` currently comes from `buildKeeperContext(currentHistory)`, flattening all history into one text block.
- `src/lib/llmClient.ts` currently dispatches one system message plus one user message.
- Internal system markers such as `sys_cancel_*`, `sys_dying_gate_*`, and `sys_madness_gate_*` are persisted in `messages` and then flattened into user text.

## Work Checklist

- [x] Create this persistent plan and interruption-resume note.
- [x] Add a prompt builder abstraction for Keeper requests.
- [x] Split Keeper prompt content into static prefix and dynamic session rules.
- [x] Add a static authorization anchor to the static prefix.
- [x] Preserve real history as provider messages instead of flattening all history into one user text.
- [x] Implement provider routing for dynamic tail rules:
  - OpenAI-compatible / DeepSeek / Grok / qiny: tail `system` where supported.
  - Gemini: downgrade dynamic rules into latest user `<session_rules>`.
  - Anthropic: keep conservative compatibility first; only use mid-conversation system/cache controls after a focused compatibility pass.
- [x] Move scenario context, inventory/combat runtime state, element runtime toggles, terminal-state reminders, madness reminders, and cancellation reports into dynamic rules or latest-user injected blocks.
- [x] Keep dice runtime unchanged; only relocate dice report prompt text if needed.
- [x] Update debug logs so console output shows static/dynamic/history sizes separately.
- [x] Add or update focused tests/manual test notes for:
  - normal rollRequest
  - bonus/penalty
  - luck burn
  - pushed roll
  - SAN check and effect roll
  - keeperRoll public/secret
  - roll cancellation
  - MCP unavailable local fallback
  - scenario scene transition and clue discovery
- [x] Run `npm run lint`.
- [x] Run `npm run validate:modules`.
- [x] Record final verification result in this file.

## Status Notes

- 2026-06-10: Plan created. No implementation changes made yet.
- 2026-06-10: Added `src/lib/keeperPromptBuilder.ts`. Keeper calls now use segmented prompt requests: static system prefix + real message history + latest user + dynamic session rules. `dispatchLlm` remains backward-compatible for CharacterCreator and other legacy single prompt callers.
- 2026-06-10: Dynamic first-party blocks moved out of the top-level Keeper system prompt: `.docs/keeper-*.json` dynamic instructions, element toggles, combat derived stats, inventory/cash/ammo runtime state, and scenario context now live in `dynamicRules`.
- 2026-06-10: Current-turn runtime gate messages (`sys_cancel_*`, `sys_dying_gate_*`, `sys_madness_gate_*`) are now lifted by `keeperPromptBuilder` into dynamic rules instead of the stable history segment. They are still stored in `messages` so UI/retry/runtime semantics remain unchanged. Dice result reports and effect reports remain normal conversation facts.
- 2026-06-10: Read-only explorer audited the dice/MCP boundary. Do not modify `RollDiceModal`, `/api/keeper/roll`, `localCocRoll`, `rollPolicy`, `rollCancellation`, SAN state-machine functions, or effect-roll settlement as part of prompt architecture work.
- 2026-06-10: Verification passed: `npm run lint`, `npm run validate:modules`, and `npm run build`. Build emitted existing CSS selector and chunk-size warnings only.
