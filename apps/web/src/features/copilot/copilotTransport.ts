import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import { vanillaClient } from '@/lib/trpc';

export type CopilotChatResult = inferRouterOutputs<AppRouter>['ai']['copilot']['chat'];

/** Data scope selected by the operator; all-sites preserves the original UI default. */
export type CopilotAnalyticsScope = 'all' | 'current';

/** User/site ownership of one response; changing it invalidates an in-flight result. */
export interface CopilotTransportScope {
  mode: CopilotAnalyticsScope;
  siteId: string | null;
  ownerKey: string;
}

interface CopilotTransportOptions {
  onResult: (result: CopilotChatResult) => void;
  /** Read at send time so a site switch cannot retain a stale transport closure. */
  getScope: () => CopilotTransportScope;
}

function textFromMessage(message: UIMessage): string {
  return message.parts
    .map(part => (part.type === 'text' ? part.text : ''))
    .join('')
    .trim();
}

function toCopilotMessages(messages: UIMessage[]) {
  return messages
    .filter(message => message.role === 'user' || message.role === 'assistant')
    .map(message => ({
      role: message.role as 'user' | 'assistant',
      content: textFromMessage(message),
    }))
    .filter(message => message.content.length > 0);
}

function textStream(text: string): ReadableStream<UIMessageChunk> {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      controller.enqueue({ type: 'start' });
      controller.enqueue({ type: 'start-step' });
      if (text.length > 0) {
        controller.enqueue({ type: 'text-start', id: 'text-1' });
        controller.enqueue({ type: 'text-delta', id: 'text-1', delta: text });
        controller.enqueue({ type: 'text-end', id: 'text-1' });
      }
      controller.enqueue({ type: 'finish-step' });
      controller.enqueue({ type: 'finish' });
      controller.close();
    },
  });
}

export function createCopilotTransport({
  onResult,
  getScope,
}: CopilotTransportOptions): ChatTransport<UIMessage> {
  return {
    async sendMessages({ messages }) {
      const scope = getScope();
      if (scope.mode === 'current' && !scope.siteId) {
        throw new Error('The current site is unavailable');
      }
      const result = await vanillaClient.ai.copilot.chat.mutate({
        messages: toCopilotMessages(messages),
        context: { siteId: scope.mode === 'current' ? scope.siteId : null },
      });
      const currentScope = getScope();
      if (
        currentScope.ownerKey !== scope.ownerKey ||
        currentScope.mode !== scope.mode ||
        (scope.mode === 'current' && currentScope.siteId !== scope.siteId)
      ) {
        // A completed request cannot repopulate another tenant/site's panel.
        return textStream('');
      }
      onResult(result);
      return textStream(result.answer);
    },

    async reconnectToStream() {
      return null;
    },
  };
}
