/**
 * HTTP server timing + body-size constants.
 *
 * The Fastify socket/keep-alive/header/request timeouts and the body
 * limit (sized against the ENG-040a invoice-OCR transport ceiling).
 * Exported so create-server and any timing test consume one source.
 *
 * @module server/constants
 */

import { INVOICE_OCR_MAX_BYTES } from '../services/ai/vision/invoice-ocr.js';

export const SERVER_KEEP_ALIVE_TIMEOUT_MS = 5_000;
export const SERVER_HEADERS_TIMEOUT_MS = 10_000;
export const SERVER_REQUEST_TIMEOUT_MS = 30_000;
export const SERVER_SOCKET_TIMEOUT_MS = 35_000;
export const SERVER_BODY_LIMIT_BYTES = Math.ceil(INVOICE_OCR_MAX_BYTES * 1.4) + 32 * 1024;
