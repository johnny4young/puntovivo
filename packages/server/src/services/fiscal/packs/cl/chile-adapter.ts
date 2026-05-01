/**
 * ENG-034 — Chile fiscal pack (NotImplemented stub).
 *
 * Real SII boleta + factura implementation lands with `ENG-036`
 * (electronic boleta + factura support, mar-2026 mandatory digital
 * delivery, 1-jan-2026 elimination of printed timbre rule, SII
 * certification flow). Until then, this stub:
 *
 * - Reports `validateConfig` issue `PACK_NOT_AVAILABLE` so the admin
 *   UI can render a friendly hint pointing at the gating ticket.
 * - Throws `FISCAL_PACK_NOT_AVAILABLE` from `issue` / `voidDocument`
 *   / `fetchStatus`. Caller in `sales.ts` already wraps
 *   `emitFiscalDocument` in a try/catch with a non-blocking
 *   `log.warn`, so a tenant flipped to `countryCode='CL'` before
 *   ENG-036 ships still completes sales — fiscal emission is just
 *   skipped with a logged signal.
 *
 * Mirrors the AI provider `notImplemented` pattern from
 * `services/ai/providers/`.
 *
 * @module services/fiscal/packs/cl/chile-adapter
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

const CL_AVAILABLE_IN = 'ENG-036';
const CL_PROVIDER_ID = 'notimpl-cl';

const CL_CAPABILITIES: FiscalAdapterCapabilities = {
  supportsVoid: false,
  supportsDebitNote: false,
  supportsFetchStatus: false,
};

export class ChileNotImplementedAdapter implements NotImplementedFiscalAdapter {
  readonly providerId = CL_PROVIDER_ID;
  readonly countryCode = 'CL';
  readonly notImplemented = true as const;
  readonly availableInTicket = CL_AVAILABLE_IN;
  readonly capabilities = CL_CAPABILITIES;

  async validateConfig(
    _input: FiscalAdapterConfig
  ): Promise<FiscalAdapterValidationResult> {
    return {
      ok: false,
      issues: [
        {
          code: 'PACK_NOT_AVAILABLE',
          field: 'countryCode',
          message: `Chile SII pack lands with ${CL_AVAILABLE_IN}.`,
        },
      ],
    };
  }

  async issue(): Promise<FiscalAdapterIssueResult> {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'FISCAL_PACK_NOT_AVAILABLE',
      message: `Chile SII pack lands with ${CL_AVAILABLE_IN}.`,
      details: { countryCode: 'CL', availableInTicket: CL_AVAILABLE_IN },
    });
  }

  async voidDocument(): Promise<FiscalAdapterIssueResult> {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'FISCAL_PACK_NOT_AVAILABLE',
      message: `Chile SII pack lands with ${CL_AVAILABLE_IN}.`,
      details: { countryCode: 'CL', availableInTicket: CL_AVAILABLE_IN },
    });
  }

  async fetchStatus(): Promise<FiscalDocumentStatus> {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'FISCAL_PACK_NOT_AVAILABLE',
      message: `Chile SII pack lands with ${CL_AVAILABLE_IN}.`,
      details: { countryCode: 'CL', availableInTicket: CL_AVAILABLE_IN },
    });
  }
}
