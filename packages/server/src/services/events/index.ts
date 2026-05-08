/**
 * ENG-070 — Public events module barrel.
 *
 * @module services/events
 */
export {
  PUBLIC_EVENT_TYPES,
  PUBLIC_EVENTS_VERSION,
  PUBLIC_EVENT_PAYLOAD_SCHEMAS,
  buildPublicEventContract,
  getPayloadSchema,
  isPublicEventType,
  type PublicEvent,
  type PublicEventContract,
  type PublicEventPayload,
  type PublicEventType,
} from './manifest.js';
export {
  projectOperationEvent,
  projectFiscalDocumentAccepted,
  type ProjectionInput,
} from './projector.js';
export {
  enqueueWebhook,
  type EnqueueWebhookArgs,
  type EnqueueWebhookResult,
} from './enqueue-webhook.js';
