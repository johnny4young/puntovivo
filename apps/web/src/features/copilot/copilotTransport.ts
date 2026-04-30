import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import { vanillaClient } from '@/lib/trpc';

export type CopilotChatResult = inferRouterOutputs<AppRouter>['ai']['copilot']['chat'];

interface CopilotTransportOptions {
  onResult: (result: CopilotChatResult) => void;
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
      controller.enqueue({ type: 'text-start', id: 'text-1' });
      controller.enqueue({ type: 'text-delta', id: 'text-1', delta: text });
      controller.enqueue({ type: 'text-end', id: 'text-1' });
      controller.enqueue({ type: 'finish-step' });
      controller.enqueue({ type: 'finish' });
      controller.close();
    },
  });
}

export function createCopilotTransport({
  onResult,
}: CopilotTransportOptions): ChatTransport<UIMessage> {
  return {
    async sendMessages({ messages }) {
      const result = await vanillaClient.ai.copilot.chat.mutate({
        messages: toCopilotMessages(messages),
      });
      onResult(result);
      return textStream(result.answer);
    },

    async reconnectToStream() {
      return null;
    },
  };
}
