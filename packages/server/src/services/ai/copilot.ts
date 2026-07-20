/**
 * - Conversational analytics co-pilot.
 *
 * The model never queries the production SQLite connection directly. Its
 * `runReadOnlySQL` tool executes against a tenant-scoped, bounded in-memory
 * analytics snapshot built from completed sales only.
 *
 * - decomposed into per-concern modules under `./copilot/`
 * (types / constants / sql / snapshot / prompts / chat). This file stays at
 * the original path as a thin re-export barrel so every importer (the
 * `services/ai/index.ts` barrel AND the direct `__tests__/ai-copilot-cache`
 * import) keeps resolving `./copilot.js` unchanged.
 *
 * @module services/ai/copilot
 */
export type {
  CopilotChatMessage,
  CopilotContextInput,
  CopilotChatInput,
  CopilotWindow,
  CopilotCellValue,
  CopilotRow,
  CopilotChart,
  CopilotSQLResult,
  CopilotChatResult,
} from './copilot/types.js';
export { copilotLimits } from './copilot/constants.js';
export { validateReadOnlySQL } from './copilot/sql.js';
export { runReadOnlySQL } from './copilot/snapshot.js';
export {
  buildSystemPrompt,
  buildContextBlock,
  injectContextIntoMessages,
} from './copilot/prompts.js';
export { runCopilotChat } from './copilot/chat.js';
