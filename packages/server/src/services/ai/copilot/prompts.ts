/**
 * co-pilot prompt assembly.
 *
 * The static system prompt ( cache-stable), the per-call dynamic
 * `<context>` block, the context-injection into the latest user turn, and the
 * flat message transcript builder. Split out of `copilot.ts` ().
 *
 * @module services/ai/copilot/prompts
 */
import type { CopilotChatMessage, CopilotWindow } from './types.js';

/**
 * Returns the co-pilot's static instruction block.
 *
 * Intentionally parameter-less so Anthropic prompt caching (the cache
 * marker advertised by `provider.cacheControlForSystemPrompt()`) sees
 * the same key on every request. The dynamic per-call context — the
 * resolved analytics window and the active UI site — lives in the
 * latest user message via {@link buildContextBlock} so the system
 * prompt stays byte-for-byte identical across calls and the cache
 * actually hits. See  for the rationale; before this fix the
 * cache hit rate on the co-pilot was effectively zero because the
 * default 90-day window embedded a fresh ISO timestamp in every call.
 */
export function buildSystemPrompt(): string {
  return [
    'You are Puntovivo analytics co-pilot for POS managers.',
    'Answer in the same language as the user, concise and operational.',
    'Always use the runReadOnlySQL tool before answering revenue, sales, product, cashier, or site questions.',
    'Never invent numbers. If a query is rejected or too broad, ask for a narrower date range or site.',
    'The only SQL tables available are:',
    '- sales_summary(sale_id, sale_number, sold_at, sale_date, site_id, site_name, cashier_id, cashier_name, customer_name, subtotal, tax_amount, discount_amount, total, payment_method, payment_status, status)',
    '- sale_line_items(sale_id, sale_number, sold_at, sale_date, site_id, site_name, product_id, product_name, sku, quantity, unit_price, discount, tax_rate, tax_amount, cost_at_sale, line_total)',
    'Use only a single SELECT or WITH statement. No semicolons, PRAGMA, ATTACH, temp tables, or mutations.',
    'The current analytics window and the active UI site context are provided in the latest user message inside a <context>...</context> block. Read those values when building SQL — the analytics_window_from / analytics_window_to ISO timestamps bound the available data, and active_site_id is the UI focus site (use it only when the user asks for the current site).',
    "For \"ayer\", filter by sale_date = date('now', '-1 day'). For site names like Sur, use lower(site_name) LIKE '%sur%'.",
    'When the SQL result has rows, summarize the answer and mention whether rows were truncated.',
  ].join('\n');
}

/**
 * Emits the per-call dynamic context as a structured block that the
 * model can parse predictably. Designed to be prepended to the latest
 * user message so the system prompt can stay invariant for caching.
 * The `<context>...</context>` markers are a model-friendly section
 * convention (Anthropic + OpenAI both parse them naturally); plain
 * `key: value` lines keep the token count tight versus JSON / YAML.
 */
export function buildContextBlock(window: CopilotWindow, siteId: string | null): string {
  return [
    '<context>',
    `analytics_window_from: ${window.from}`,
    `analytics_window_to: ${window.to}`,
    `analytics_window_defaulted: ${window.defaulted ? 'true' : 'false'}`,
    `active_site_id: ${siteId ?? 'none'}`,
    '</context>',
  ].join('\n');
}

/**
 * Prepends the context block to the LAST user message in the
 * conversation. Only the most recent user turn carries the context so
 * the model always evaluates against fresh window + site values; earlier
 * historical user turns stay untouched, which keeps the message log
 * legible if the operator inspects a trace.
 *
 * Returns a new array — never mutates the input. If the array somehow
 * has zero user messages (the Zod schema's `min(1)` makes this
 * unreachable today, but we defend), a synthetic user message carrying
 * only the context is appended.
 */
export function injectContextIntoMessages(
  messages: CopilotChatMessage[],
  contextBlock: string
): CopilotChatMessage[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role === 'user') {
      const updated = messages.slice();
      updated[i] = { ...message, content: `${contextBlock}\n\n${message.content}` };
      return updated;
    }
  }
  return [...messages, { role: 'user', content: contextBlock }];
}

export function buildPrompt(messages: CopilotChatMessage[]): string {
  return messages
    .map(message => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`)
    .join('\n\n');
}
