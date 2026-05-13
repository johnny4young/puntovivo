/**
 * ENG-040c slice 2 — convert a recorded audio Blob into a base64
 * payload + the resolved MIME type the server expects.
 *
 * Uses `FileReader.readAsDataURL` because it is the only browser
 * primitive that produces base64 without an explicit buffer hop.
 * The reader's data URL prefix (`data:<mime>;base64,`) is stripped
 * before resolving so the caller can pass the bare base64 string
 * straight into `ai.transcribeAudio`. The server's Zod schema
 * already accepts either form, but stripping client-side keeps the
 * audit-log byte counters honest and saves ~25 bytes per call.
 *
 * The resolved `mimeType` strips MediaRecorder's optional codec
 * parameters (e.g. `audio/webm;codecs=opus`) because the server
 * whitelist only accepts the bare MIME literals.
 *
 * @module features/company/blobToBase64
 */
export interface BlobBase64Payload {
  base64: string;
  mimeType: string;
}

export async function blobToBase64(blob: Blob): Promise<BlobBase64Payload> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error('FileReader failed to read blob'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('FileReader returned a non-string result'));
        return;
      }
      resolve(result);
    };
    reader.readAsDataURL(blob);
  });

  // Data URL shape: `data:<mime>;base64,<payload>`. The split below
  // intentionally tolerates extra `;`-separated parameters that
  // browsers add for codec info — only the head and the final base64
  // chunk matter for downstream consumers.
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 0) {
    throw new Error('Unexpected FileReader output: missing base64 payload');
  }
  const base64 = dataUrl.slice(commaIndex + 1);
  const header = dataUrl.slice('data:'.length, commaIndex);
  const mimeType = header.split(';')[0] ?? blob.type ?? '';

  return { base64, mimeType };
}
