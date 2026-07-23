export interface ParsedSseEvent {
  event: string;
  data: string;
  id?: string;
  retry?: number;
}

export interface SseParser {
  push(chunk: string): void;
  reset(): void;
}

/**
 * Incremental parser for the text/event-stream wire format.
 *
 * The parser is deliberately runtime-neutral so the browser fetch client and
 * Electron main-process Store Hub relay share exactly the same framing rules.
 */
export function createSseParser(onEvent: (event: ParsedSseEvent) => void): SseParser {
  let buffer = '';
  let eventName = 'message';
  let dataLines: string[] = [];
  let eventId: string | undefined;
  let retry: number | undefined;

  function resetEvent(): void {
    eventName = 'message';
    dataLines = [];
    eventId = undefined;
    retry = undefined;
  }

  function dispatch(): void {
    if (dataLines.length === 0) {
      resetEvent();
      return;
    }
    onEvent({
      event: eventName,
      data: dataLines.join('\n'),
      ...(eventId !== undefined ? { id: eventId } : {}),
      ...(retry !== undefined ? { retry } : {}),
    });
    resetEvent();
  }

  function consumeLine(rawLine: string): void {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line === '') {
      dispatch();
      return;
    }
    if (line.startsWith(':')) return;

    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    switch (field) {
      case 'event':
        eventName = value || 'message';
        break;
      case 'data':
        dataLines.push(value);
        break;
      case 'id':
        if (!value.includes('\0')) eventId = value;
        break;
      case 'retry':
        if (/^\d+$/.test(value)) retry = Number(value);
        break;
      default:
        break;
    }
  }

  return {
    push(chunk) {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        consumeLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
      }
    },
    reset() {
      buffer = '';
      resetEvent();
    },
  };
}
