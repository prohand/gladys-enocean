import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Esp3Parser, PACKET_TYPES, crc8, encodePacket } from '../src/enocean/esp3.js';

test('frames match the vectors of the ESP3 specification', () => {
  // CO_RD_VERSION and CO_RD_IDBASE, as printed in the ESP3 specification.
  assert.deepEqual(
    encodePacket(PACKET_TYPES.COMMON_COMMAND, Buffer.from([0x03])),
    Buffer.from('5500010005700309', 'hex'),
  );
  assert.deepEqual(
    encodePacket(PACKET_TYPES.COMMON_COMMAND, Buffer.from([0x08])),
    Buffer.from('5500010005700838', 'hex'),
  );
  assert.equal(crc8(Buffer.from([0x00, 0x01, 0x00, 0x05])), 0x70);
});

test('the parser rebuilds frames split in arbitrary chunks', () => {
  const packets = [];
  const parser = new Esp3Parser((packet) => packets.push(packet));
  const frame = encodePacket(
    PACKET_TYPES.RADIO_ERP1,
    Buffer.from('f630fef1a2b330', 'hex'),
    Buffer.from('01ffffffff4d00', 'hex'),
  );
  for (const byte of frame) {
    parser.push(Buffer.from([byte]));
  }
  assert.equal(packets.length, 1);
  assert.equal(packets[0].type, PACKET_TYPES.RADIO_ERP1);
  assert.deepEqual(packets[0].data, Buffer.from('f630fef1a2b330', 'hex'));
  assert.deepEqual(packets[0].optional, Buffer.from('01ffffffff4d00', 'hex'));
  assert.equal(parser.pending, 0);
});

test('garbage and corrupted frames cost one frame, never the stream', () => {
  const packets = [];
  const discarded = [];
  const parser = new Esp3Parser(
    (packet) => packets.push(packet),
    (bytes) => discarded.push(bytes),
  );
  const good = encodePacket(PACKET_TYPES.RESPONSE, Buffer.from([0x00]));
  const corrupted = Buffer.from(good);
  corrupted[6] = 0x01; // data byte flipped: data CRC wrong
  // A stray 0x55 inside garbage, before the real frames.
  parser.push(Buffer.concat([Buffer.from([0x12, 0x55, 0x00, 0x99]), corrupted, good, good]));
  assert.equal(packets.length, 2);
  assert.ok(discarded.length > 0);
});

test('two frames in one chunk are both delivered', () => {
  const packets = [];
  const parser = new Esp3Parser((packet) => packets.push(packet));
  const a = encodePacket(PACKET_TYPES.RESPONSE, Buffer.from([0x00]));
  const b = encodePacket(PACKET_TYPES.EVENT, Buffer.from([0x02, 0x01]));
  parser.push(Buffer.concat([a, b]));
  assert.deepEqual(
    packets.map((p) => p.type),
    [PACKET_TYPES.RESPONSE, PACKET_TYPES.EVENT],
  );
});
