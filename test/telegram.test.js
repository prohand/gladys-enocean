import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RORG,
  addToId,
  decodeErp1,
  encodeErp1,
  normalizeId,
  teachInInfo,
  uteResponse,
} from '../src/enocean/telegram.js';

test('ids are read however they are typed', () => {
  assert.equal(normalizeId('0194e3b2'), '0194E3B2');
  assert.equal(normalizeId('01:94:E3:B2'), '0194E3B2');
  assert.equal(normalizeId('0x0194E3B2'), '0194E3B2');
  assert.equal(normalizeId(' 01-94-e3-b2 '), '0194E3B2');
  assert.equal(normalizeId('0194E3B'), null);
  assert.equal(normalizeId('ZZ94E3B2'), null);
  assert.equal(normalizeId({}), null);
});

test('a channel is added to the base id', () => {
  assert.equal(addToId('FF8A1C00', 0), 'FF8A1C00');
  assert.equal(addToId('FF8A1C00', 127), 'FF8A1C7F');
});

test('an ERP1 telegram survives an encode/decode round trip', () => {
  const { data, optional } = encodeErp1({
    rorg: RORG.BS4,
    payload: [0x01, 0x02, 0x03, 0x08],
    senderId: 'FF8A1C05',
    destinationId: '05123456',
  });
  const telegram = decodeErp1({ data, optional });
  assert.equal(telegram.rorg, RORG.BS4);
  assert.deepEqual([...telegram.payload], [0x01, 0x02, 0x03, 0x08]);
  assert.equal(telegram.senderId, 'FF8A1C05');
  assert.equal(telegram.destinationId, '05123456');
});

test('the dBm byte reads as a negative signal', () => {
  const telegram = decodeErp1({
    data: Buffer.from('d509 0194e3b2 00'.replaceAll(' ', ''), 'hex'),
    optional: Buffer.from('01ffffffff4f00', 'hex'),
  });
  assert.equal(telegram.dbm, -79);
  assert.equal(telegram.senderId, '0194E3B2');
});

test('a 4BS teach-in with its profile names the EEP and the manufacturer', () => {
  // A5-02-05, manufacturer 0x00D (Eltako).
  const info = teachInInfo({ rorg: RORG.BS4, payload: Buffer.from([0x08, 0x28, 0x0d, 0x80]) });
  assert.deepEqual(info, { kind: '4BS', eep: 'A5-02-05', manufacturer: 0x00d });
  // The Eltako A5-38-08 learn telegram.
  assert.equal(
    teachInInfo({ rorg: RORG.BS4, payload: Buffer.from([0xe0, 0x40, 0x0d, 0x80]) }).eep,
    'A5-38-08',
  );
  // A data telegram (LRN bit at 1) is not a teach-in.
  assert.equal(teachInInfo({ rorg: RORG.BS4, payload: Buffer.from([0, 0, 0x80, 0x08]) }), null);
});

test('a UTE query is read and answered with the same profile', () => {
  // Bidirectional teach-in query of a D2-01-12, 2 channels, manufacturer 0x046 (NodOn).
  const query = Buffer.from([0xa0, 0x02, 0x46, 0x00, 0x12, 0x01, 0xd2]);
  const info = teachInInfo({ rorg: RORG.UTE, payload: query });
  assert.equal(info.eep, 'D2-01-12');
  assert.equal(info.manufacturer, 0x046);
  // 0xA0: bidirectional, answer expected, teach-in or deletion not specified.
  assert.equal(info.request, 'either');
  assert.equal(info.expectsResponse, true);
  query[0] = 0x80;
  assert.equal(teachInInfo({ rorg: RORG.UTE, payload: query }).request, 'teach-in');
  const response = uteResponse(query, 'teach-in');
  assert.equal(response[0], 0x91);
  assert.deepEqual([...response.subarray(1)], [...query.subarray(1)]);
});
