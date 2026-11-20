import { roundMoney } from './money.ts';

/** Where a site receives transfers: a Bre-B key, a wallet number or a bank account. */
export const TRANSFER_DESTINATION_KINDS = ['bre_b', 'nequi', 'daviplata', 'bank_account'] as const;
export type TransferDestinationKind = (typeof TRANSFER_DESTINATION_KINDS)[number];

export const BANK_ACCOUNT_TYPES = ['savings', 'checking'] as const;
export type BankAccountType = (typeof BANK_ACCOUNT_TYPES)[number];

export const MAX_SITE_TRANSFER_DESTINATIONS = 6;

export const TRANSFER_DESTINATION_LIMITS = {
  label: 40,
  account: 100,
  bankName: 60,
  holderName: 80,
  holderId: 20,
  qrPayload: 512,
} as const;

export const TRANSFER_QR_LOCALES = ['es', 'en'] as const;
export type TransferQrLocale = (typeof TRANSFER_QR_LOCALES)[number];

const BRAND: Record<Exclude<TransferDestinationKind, 'bank_account'>, string> = {
  bre_b: 'Bre-B',
  nequi: 'Nequi',
  daviplata: 'Daviplata',
};

const ACCOUNT_TYPE_WORD: Record<TransferQrLocale, Record<BankAccountType, string>> = {
  es: { savings: 'Ahorros', checking: 'Corriente' },
  en: { savings: 'Savings', checking: 'Checking' },
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALIAS = /^@[A-Za-z0-9._-]{3,40}$/;

/** Digits only, without a +57 country prefix on a mobile number. */
function localDigits(raw: string): string {
  const digits = raw.replace(/[\s.\-+()]/g, '');
  return /^573\d{9}$/.test(digits) ? digits.slice(2) : digits;
}

/**
 * Canonical account for a destination, or null when it is not valid for the
 * kind. Bre-B keys accept an @ alias, an email or a number (phone, ID or
 * merchant code); wallets need a Colombian mobile number.
 */
export function normalizeTransferAccount(
  kind: TransferDestinationKind,
  raw: string
): string | null {
  const value = raw.trim();
  if (!value || value.length > TRANSFER_DESTINATION_LIMITS.account) return null;
  switch (kind) {
    case 'bre_b': {
      if (value.startsWith('@')) return ALIAS.test(value) ? value : null;
      if (value.includes('@')) return EMAIL.test(value) ? value : null;
      const digits = localDigits(value);
      return /^\d{6,20}$/.test(digits) ? digits : null;
    }
    case 'nequi':
    case 'daviplata': {
      const digits = localDigits(value);
      return /^3\d{9}$/.test(digits) ? digits : null;
    }
    case 'bank_account': {
      const digits = value.replace(/[\s.-]/g, '');
      return /^\d{6,20}$/.test(digits) ? digits : null;
    }
  }
}

/** How the register shows the account: mobile numbers grouped 3-3-4. */
export function formatTransferAccount(account: string): string {
  return /^3\d{9}$/.test(account)
    ? `${account.slice(0, 3)} ${account.slice(3, 6)} ${account.slice(6)}`
    : account;
}

/** Label a destination gets when the owner leaves it blank. */
export function defaultTransferLabel(
  kind: TransferDestinationKind,
  bankName: string | null
): string {
  return kind === 'bank_account' ? (bankName ?? '') : BRAND[kind];
}

function utf8Bytes(input: string): number[] {
  const bytes: number[] = [];
  for (const char of input) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }
  return bytes;
}

/** The 16-bit CCITT-FALSE checksum EMVCo QR codes carry in tag 63, over UTF-8 bytes. */
export function crc16Ccitt(input: string): string {
  let crc = 0xffff;
  for (const byte of utf8Bytes(input)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * True for a well-formed EMVCo merchant-presented payload: format indicator
 * first, every tag's length consistent, CRC tag last and matching.
 */
export function isEmvcoQrPayload(payload: string): boolean {
  if (payload.length > TRANSFER_DESTINATION_LIMITS.qrPayload || !payload.startsWith('000201')) {
    return false;
  }
  let offset = 0;
  while (offset < payload.length) {
    const head = payload.slice(offset, offset + 4);
    if (!/^\d{4}$/.test(head)) return false;
    const tag = head.slice(0, 2);
    const length = Number(head.slice(2));
    const end = offset + 4 + length;
    if (end > payload.length) return false;
    if (tag === '63') {
      return (
        length === 4 &&
        end === payload.length &&
        payload.slice(offset + 4, end).toUpperCase() === crc16Ccitt(payload.slice(0, offset + 4))
      );
    }
    offset = end;
  }
  return false;
}

export interface TransferQrDestination {
  kind: TransferDestinationKind;
  account: string;
  bankName: string | null;
  accountType: BankAccountType | null;
  holderName: string | null;
  holderId: string | null;
  qrPayload: string | null;
}

export interface TransferQr {
  /** `emvco`: the bank's own QR, shown as stored. `text`: the destination written out. */
  format: 'emvco' | 'text';
  payload: string;
  /** False when the customer types the amount in their app. */
  amountIncluded: boolean;
}

function formatAmount(amount: number): string {
  const rounded = roundMoney(amount);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

/**
 * QR content for one destination. A bank-issued EMVCo payload wins because
 * banking apps can pay it; it is never edited, so the amount stays out of it.
 * Otherwise the QR spells out where to send the money and how much.
 */
export function buildTransferQr(
  destination: TransferQrDestination,
  options: { amount?: number | null; currency: string; locale?: TransferQrLocale }
): TransferQr {
  if (destination.qrPayload && isEmvcoQrPayload(destination.qrPayload)) {
    return { format: 'emvco', payload: destination.qrPayload, amountIncluded: false };
  }
  const locale = options.locale ?? 'es';
  const heading =
    destination.kind === 'bank_account'
      ? [
          destination.bankName,
          destination.accountType && ACCOUNT_TYPE_WORD[locale][destination.accountType],
        ]
          .filter(Boolean)
          .join(' · ')
      : BRAND[destination.kind];
  const amount = options.amount && options.amount > 0 ? options.amount : null;
  const lines = [
    heading,
    formatTransferAccount(destination.account),
    destination.holderName,
    destination.holderId,
    amount === null ? null : `${options.currency} ${formatAmount(amount)}`,
  ].filter((line): line is string => Boolean(line));
  return { format: 'text', payload: lines.join('\n'), amountIncluded: amount !== null };
}
