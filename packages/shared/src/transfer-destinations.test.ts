import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTransferQr,
  crc16Ccitt,
  defaultTransferLabel,
  formatTransferAccount,
  isEmvcoQrPayload,
  normalizeTransferAccount,
  type TransferQrDestination,
} from './transfer-destinations.ts';

const withCrc = (body: string) => `${body}6304${crc16Ccitt(`${body}6304`)}`;
const STATIC_QR = withCrc(
  '000201010211' + '2625' + '0013CO.EXAMPLE.QR' + '0104ABCD' + '5303170' + '5802CO'
);

const destination = (overrides: Partial<TransferQrDestination> = {}): TransferQrDestination => ({
  kind: 'nequi',
  account: '3105550142',
  bankName: null,
  accountType: null,
  holderName: null,
  holderId: null,
  qrPayload: null,
  ...overrides,
});

test('the checksum matches the published check value', () => {
  assert.equal(crc16Ccitt('123456789'), '29B1');
  assert.equal(crc16Ccitt('ñ€😀'), '6473');
});

test('Bre-B keys accept an alias, an email or a number', () => {
  assert.equal(normalizeTransferAccount('bre_b', ' @TiendaDemo '), '@TiendaDemo');
  assert.equal(normalizeTransferAccount('bre_b', 'pagos@demo.co'), 'pagos@demo.co');
  assert.equal(normalizeTransferAccount('bre_b', '+57 310 555 0142'), '3105550142');
  assert.equal(normalizeTransferAccount('bre_b', '900.123.456'), '900123456');
  assert.equal(normalizeTransferAccount('bre_b', '@ab'), null);
  assert.equal(normalizeTransferAccount('bre_b', 'not a key'), null);
});

test('wallets need a Colombian mobile number and bank accounts digits', () => {
  assert.equal(normalizeTransferAccount('nequi', '310-555-0142'), '3105550142');
  assert.equal(normalizeTransferAccount('daviplata', '6015550142'), null);
  assert.equal(normalizeTransferAccount('bank_account', '123-456789-01'), '12345678901');
  assert.equal(normalizeTransferAccount('bank_account', '12AB'), null);
  assert.equal(normalizeTransferAccount('nequi', '   '), null);
});

test('mobile numbers are grouped for reading and labels default to the brand or bank', () => {
  assert.equal(formatTransferAccount('3105550142'), '310 555 0142');
  assert.equal(formatTransferAccount('@tienda'), '@tienda');
  assert.equal(defaultTransferLabel('nequi', null), 'Nequi');
  assert.equal(defaultTransferLabel('bank_account', 'Banco Demo'), 'Banco Demo');
});

test('an EMVCo payload must be well formed and carry a matching checksum', () => {
  assert.equal(isEmvcoQrPayload(STATIC_QR), true);
  assert.equal(isEmvcoQrPayload(STATIC_QR.replace('ABCD', 'ABCE')), false);
  assert.equal(isEmvcoQrPayload(STATIC_QR.slice(0, -1)), false);
  assert.equal(isEmvcoQrPayload('hello'), false);
  assert.equal(isEmvcoQrPayload(withCrc('000201' + '2699ABC')), false);
});

test('the text QR writes out the destination and the amount', () => {
  const qr = buildTransferQr(destination({ holderName: 'Tienda Demo' }), {
    amount: 87420,
    currency: 'COP',
  });
  assert.deepEqual(qr, {
    format: 'text',
    payload: 'Nequi\n310 555 0142\nTienda Demo\nCOP 87420',
    amountIncluded: true,
  });

  const bank = buildTransferQr(
    destination({
      kind: 'bank_account',
      account: '12345678901',
      bankName: 'Banco Demo',
      accountType: 'savings',
      holderId: '900123456',
    }),
    { amount: 10.505, currency: 'COP', locale: 'en' }
  );
  assert.equal(bank.payload, 'Banco Demo · Savings\n12345678901\n900123456\nCOP 10.51');

  const noAmount = buildTransferQr(destination(), { amount: 0, currency: 'COP' });
  assert.equal(noAmount.amountIncluded, false);
  assert.equal(noAmount.payload, 'Nequi\n310 555 0142');
});

test('a bank-issued QR is shown as stored and leaves the amount to the customer', () => {
  const qr = buildTransferQr(
    destination({ kind: 'bre_b', account: '@tienda', qrPayload: STATIC_QR }),
    {
      amount: 5000,
      currency: 'COP',
    }
  );
  assert.deepEqual(qr, { format: 'emvco', payload: STATIC_QR, amountIncluded: false });

  const broken = buildTransferQr(destination({ qrPayload: 'garbage' }), {
    amount: 5000,
    currency: 'COP',
  });
  assert.equal(broken.format, 'text');
});
