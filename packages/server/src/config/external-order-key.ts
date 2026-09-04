/** Optional connector wrapping key for standalone development with an intentionally unkeyed test DB. */
export function resolveExternalOrderWrappingKey(input: {
  dedicated?: string | undefined;
  databaseKey?: string | undefined;
  webhookKey?: string | undefined;
}): string | undefined {
  if (input.dedicated !== undefined) {
    if (input.dedicated.length !== 64 || !/^[a-fA-F0-9]{64}$/.test(input.dedicated))
      throw new Error(
        'PUNTOVIVO_EXTERNAL_ORDER_KEY must contain 64 hexadecimal characters (32 random bytes)'
      );
    return input.dedicated;
  }
  return input.webhookKey ?? input.databaseKey;
}
