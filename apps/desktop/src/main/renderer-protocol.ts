/**
 * Secure packaged-renderer protocol.
 *
 * ES modules cannot be loaded from file:// in Chromium because every file URL
 * has an opaque origin. The packaged UI therefore runs from a standard,
 * privileged Puntovivo origin while the handler resolves assets exclusively
 * inside resources/dist.
 */

import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CustomScheme } from 'electron';

export const PACKAGED_RENDERER_SCHEME = 'puntovivo-app';
export const PACKAGED_RENDERER_HOST = 'app';
export const PACKAGED_RENDERER_ORIGIN = `${PACKAGED_RENDERER_SCHEME}://${PACKAGED_RENDERER_HOST}`;
export const PACKAGED_RENDERER_ENTRY_URL = `${PACKAGED_RENDERER_ORIGIN}/index.html`;

interface SchemeRegistrar {
  registerSchemesAsPrivileged: (customSchemes: CustomScheme[]) => void;
}

interface ProtocolHandlerRegistrar {
  handle: (scheme: string, handler: (request: Request) => Promise<Response> | Response) => void;
}

interface RendererProtocolNet {
  fetch: (input: string) => Promise<Response>;
}

export function registerPackagedRendererScheme(protocol: SchemeRegistrar): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PACKAGED_RENDERER_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
}

export function isPackagedRendererUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === `${PACKAGED_RENDERER_SCHEME}:` && url.hostname === PACKAGED_RENDERER_HOST
    );
  } catch {
    return false;
  }
}

export function resolvePackagedRendererPath(
  rendererRoot: string,
  requestUrl: string
): string | null {
  if (!isPackagedRendererUrl(requestUrl)) return null;

  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(requestUrl).pathname);
  } catch {
    return null;
  }

  const requestedPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const root = resolve(rendererRoot);
  const candidate = resolve(root, requestedPath);
  const relativePath = relative(root, candidate);
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) return null;
  return candidate;
}

export function installPackagedRendererProtocol(args: {
  protocol: ProtocolHandlerRegistrar;
  net: RendererProtocolNet;
  rendererRoot: string;
}): void {
  args.protocol.handle(PACKAGED_RENDERER_SCHEME, request => {
    const assetPath = resolvePackagedRendererPath(args.rendererRoot, request.url);
    if (!assetPath) return new Response('Not found', { status: 404 });
    return args.net.fetch(pathToFileURL(assetPath).toString());
  });
}
