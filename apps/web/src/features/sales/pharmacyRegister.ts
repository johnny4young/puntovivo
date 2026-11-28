import { ISO_DATE_ONLY_PATTERN, parseStrictIsoInstant } from '@puntovivo/shared/iso-date';
import { dateTimeFormatter } from '@/lib/dateTimeFormatter';
import type { PharmacyClassification, ProductNextLot } from '@/types';
import {
  selectedEvidenceCoversRequirement,
  type EligiblePharmacyEvidence,
  type PharmacyCheckoutRequirement,
} from './pharmacyCheckout';

/** The checkout preflight row with the fields the register reads. */
export interface PharmacyTicketRequirement extends PharmacyCheckoutRequirement {
  customerRequired: boolean;
  nextLot: ProductNextLot | null;
  eligibleEvidence: Array<
    EligiblePharmacyEvidence & {
      expiresAt: string;
      authorizedQuantity: number;
      approverName: string;
    }
  >;
}

export type PharmacyLineStatus =
  { kind: 'ready'; approverName: string } | { kind: 'missing' } | { kind: 'blocked' };

export interface PharmacyLineHint {
  classification: PharmacyClassification;
  nextLot: ProductNextLot | null;
  /** Null for OTC lines and for controlled ones, whose class tag already says it. */
  status: PharmacyLineStatus | null;
}

/** A missing customer is the card's job; every other refusal blocks the line. */
const hardBlocked = (requirement: PharmacyTicketRequirement) =>
  requirement.blockedErrorCode !== null &&
  requirement.blockedErrorCode !== 'PHARMACY_CUSTOMER_REQUIRED';

function lineStatus(requirement: PharmacyTicketRequirement): PharmacyLineStatus | null {
  if (
    requirement.classification === 'controlled' &&
    requirement.blockedErrorCode === 'PHARMACY_CONTROLLED_NOT_ENABLED'
  ) {
    return null;
  }
  if (hardBlocked(requirement)) return { kind: 'blocked' };
  if (!requirement.evidenceRequired) return null;
  const covered = selectedEvidenceCoversRequirement(
    requirement,
    requirement.eligibleEvidence.map(evidence => evidence.id)
  );
  return covered
    ? { kind: 'ready', approverName: requirement.eligibleEvidence[0]!.approverName }
    : { kind: 'missing' };
}

/** What the ticket line says about a medicine; checkout stays the authority. */
export function pharmacyLineHint(requirement: PharmacyTicketRequirement): PharmacyLineHint {
  return {
    classification: requirement.classification,
    nextLot: requirement.nextLot,
    status: lineStatus(requirement),
  };
}

export type PharmacyCustomerNote =
  | { missing: true }
  | {
      missing: false;
      /** Earliest expiry among the prescriptions this ticket would use. */
      validUntil: string | null;
      /** Remaining and authorized quantity when one medicine needs a prescription. */
      quantity: { remaining: number; authorized: number } | null;
    };

/** The card under the ticket; null when no line needs a named customer. */
export function pharmacyCustomerNote(
  requirements: readonly PharmacyTicketRequirement[],
  hasCustomer: boolean
): PharmacyCustomerNote | null {
  const needing = requirements.filter(
    requirement => requirement.customerRequired && !hardBlocked(requirement)
  );
  if (needing.length === 0) return null;
  // An attached customer the policy rejects (inactive, erased) still leaves the ticket without one.
  const rejected = needing.some(
    requirement => requirement.blockedErrorCode === 'PHARMACY_CUSTOMER_REQUIRED'
  );
  if (!hasCustomer || rejected) return { missing: true };
  const evidence = needing.flatMap(requirement => requirement.eligibleEvidence);
  const validUntil = evidence.reduce<string | null>(
    (earliest, row) => (earliest === null || row.expiresAt < earliest ? row.expiresAt : earliest),
    null
  );
  const single = needing.length === 1 ? needing[0]!.eligibleEvidence : [];
  const quantity =
    single.length > 0
      ? {
          remaining: single.reduce((sum, row) => sum + row.remainingQuantity, 0),
          authorized: single.reduce((sum, row) => sum + row.authorizedQuantity, 0),
        }
      : null;
  return { missing: false, validUntil, quantity };
}

function calendarDate(value: string): Date | null {
  const day = value.slice(0, 10);
  if (!ISO_DATE_ONLY_PATTERN.test(day)) return null;
  const time = parseStrictIsoInstant(day);
  return time === null ? null : new Date(time);
}

/** «mar 2027» / «Mar 2027»: the month a lot expires, read as a calendar date. */
export function formatLotMonth(expiresAt: string, locale: string): string {
  const date = calendarDate(expiresAt);
  if (!date) return '';
  const parts = dateTimeFormatter(locale, {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).formatToParts(date);
  const month = parts.find(part => part.type === 'month')?.value.replace('.', '') ?? '';
  const year = parts.find(part => part.type === 'year')?.value ?? '';
  return `${month} ${year}`.trim();
}

/** «25 de noviembre» / «November 25». */
export function formatDayMonth(day: string, locale: string): string {
  const date = calendarDate(day);
  if (!date) return '';
  return dateTimeFormatter(locale, { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(date);
}
