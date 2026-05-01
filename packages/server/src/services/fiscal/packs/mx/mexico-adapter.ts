/**
 * ENG-034 — Mexico fiscal pack (NotImplemented stub).
 *
 * Real CFDI 4.0 implementation lands with `ENG-035` (PAC integration,
 * RFC validation, January 2026 SAT catalog refresh, complemento
 * Pago 2.0). Until then, this stub:
 *
 * - Reports `validateConfig` issue `PACK_NOT_AVAILABLE` so the admin
 *   UI can render a friendly hint pointing at the gating ticket.
 * - Throws `FISCAL_PACK_NOT_AVAILABLE` from `issue` / `voidDocument`
 *   / `fetchStatus`. Caller in `sales.ts` already wraps
 *   `emitFiscalDocument` in a try/catch with a non-blocking
 *   `log.warn`, so a tenant flipped to `countryCode='MX'` before
 *   ENG-035 ships still completes sales — fiscal emission is just
 *   skipped with a logged signal.
 *
 * Mirrors the AI provider `notImplemented` pattern from
 * `services/ai/providers/openai.ts` pre-ENG-044 (since shipped) and
 * `services/ai/providers/ollama.ts` (still parked for ENG-040).
 *
 * @module services/fiscal/packs/mx/mexico-adapter
 */

import type { FiscalDocumentStatus } from '../../../../db/schema.js';
import { throwServerError } from '../../../../lib/errorCodes.js';
import type {
  FiscalAdapterCapabilities,
  FiscalAdapterConfig,
  FiscalAdapterIssueResult,
  FiscalAdapterValidationResult,
  NotImplementedFiscalAdapter,
} from '../../adapter.js';

const MX_AVAILABLE_IN = 'ENG-035';
const MX_PROVIDER_ID = 'notimpl-mx';

const MX_CAPABILITIES: FiscalAdapterCapabilities = {
  supportsVoid: false,
  supportsDebitNote: false,
  supportsFetchStatus: false,
};

export class MexicoNotImplementedAdapter implements NotImplementedFiscalAdapter {
  readonly providerId = MX_PROVIDER_ID;
  readonly countryCode = 'MX';
  readonly notImplemented = true as const;
  readonly availableInTicket = MX_AVAILABLE_IN;
  readonly capabilities = MX_CAPABILITIES;

  async validateConfig(
    _input: FiscalAdapterConfig
  ): Promise<FiscalAdapterValidationResult> {
    return {
      ok: false,
      issues: [
        {
          code: 'PACK_NOT_AVAILABLE',
          field: 'countryCode',
          message: `Mexico CFDI 4.0 pack lands with ${MX_AVAILABLE_IN}.`,
        },
      ],
    };
  }

  async issue(): Promise<FiscalAdapterIssueResult> {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'FISCAL_PACK_NOT_AVAILABLE',
      message: `Mexico CFDI 4.0 pack lands with ${MX_AVAILABLE_IN}.`,
      details: { countryCode: 'MX', availableInTicket: MX_AVAILABLE_IN },
    });
  }

  async voidDocument(): Promise<FiscalAdapterIssueResult> {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'FISCAL_PACK_NOT_AVAILABLE',
      message: `Mexico CFDI 4.0 pack lands with ${MX_AVAILABLE_IN}.`,
      details: { countryCode: 'MX', availableInTicket: MX_AVAILABLE_IN },
    });
  }

  async fetchStatus(): Promise<FiscalDocumentStatus> {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'FISCAL_PACK_NOT_AVAILABLE',
      message: `Mexico CFDI 4.0 pack lands with ${MX_AVAILABLE_IN}.`,
      details: { countryCode: 'MX', availableInTicket: MX_AVAILABLE_IN },
    });
  }
}
