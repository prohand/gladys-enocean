// -----------------------------------------------------------------------------
// EnOcean Serial Protocol 3 (ESP3): the byte framing spoken by the USB 300,
// the TCM 310 and every gateway built on them.
//
//   0x55 | data length (2, BE) | optional length (1) | packet type (1) | CRC8H
//        | data | optional data | CRC8D
//
// Both CRCs are CRC-8, polynomial 0x07, initial value 0. Over ser2net the bytes
// arrive in arbitrary chunks, and a connection opened mid-frame starts with
// garbage: the parser keeps a buffer, looks for a 0x55 whose header CRC is
// right, and drops one byte at a time until it finds one. A frame whose data
// CRC is wrong is dropped the same way, so one corrupted byte costs one frame,
// never the stream.
// -----------------------------------------------------------------------------

export const SYNC_BYTE = 0x55;

export const PACKET_TYPES = {
  RADIO_ERP1: 0x01,
  RESPONSE: 0x02,
  RADIO_SUB_TEL: 0x03,
  EVENT: 0x04,
  COMMON_COMMAND: 0x05,
  SMART_ACK_COMMAND: 0x06,
  REMOTE_MAN_COMMAND: 0x07,
  RADIO_MESSAGE: 0x09,
  RADIO_ERP2: 0x0a,
};

export const COMMON_COMMANDS = {
  CO_RD_VERSION: 0x03,
  CO_RD_IDBASE: 0x08,
};

/** Return codes of a RESPONSE packet (data byte 0). */
export const RETURN_CODES = {
  0x00: 'OK',
  0x01: 'ERROR',
  0x02: 'NOT_SUPPORTED',
  0x03: 'WRONG_PARAM',
  0x04: 'OPERATION_DENIED',
  0x05: 'LOCK_SET',
  0x06: 'BUFFER_TOO_SMALL',
  0x07: 'NO_FREE_BUFFER',
};

const CRC8_TABLE = (() => {
  const table = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) {
    let crc = i;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
    table[i] = crc;
  }
  return table;
})();

/**
 * CRC-8 (polynomial 0x07) of `bytes[start..end)`.
 * @param {Uint8Array} bytes
 * @param {number} [start]
 * @param {number} [end]
 */
export function crc8(bytes, start = 0, end = bytes.length) {
  let crc = 0;
  for (let i = start; i < end; i += 1) {
    crc = CRC8_TABLE[(crc ^ bytes[i]) & 0xff];
  }
  return crc;
}

/**
 * Build one ESP3 frame.
 * @param {number} type packet type, see PACKET_TYPES
 * @param {Uint8Array} data
 * @param {Uint8Array} [optional]
 * @returns {Buffer}
 */
export function encodePacket(type, data, optional = Buffer.alloc(0)) {
  const frame = Buffer.alloc(7 + data.length + optional.length);
  frame[0] = SYNC_BYTE;
  frame.writeUInt16BE(data.length, 1);
  frame[3] = optional.length;
  frame[4] = type;
  frame[5] = crc8(frame, 1, 5);
  Buffer.from(data).copy(frame, 6);
  Buffer.from(optional).copy(frame, 6 + data.length);
  frame[frame.length - 1] = crc8(frame, 6, frame.length - 1);
  return frame;
}

/**
 * Incremental ESP3 decoder: feed it whatever the socket gives, it calls
 * `onPacket({ type, data, optional })` once per valid frame.
 */
export class Esp3Parser {
  #buffer = Buffer.alloc(0);
  #onPacket;
  #onDiscard;

  /**
   * @param {(packet: { type: number, data: Buffer, optional: Buffer }) => void} onPacket
   * @param {(bytes: number, reason: string) => void} [onDiscard] told about dropped bytes
   */
  constructor(onPacket, onDiscard = () => {}) {
    this.#onPacket = onPacket;
    this.#onDiscard = onDiscard;
  }

  /** Bytes waiting for the rest of their frame. */
  get pending() {
    return this.#buffer.length;
  }

  reset() {
    this.#buffer = Buffer.alloc(0);
  }

  /** @param {Uint8Array} chunk */
  push(chunk) {
    this.#buffer = this.#buffer.length
      ? Buffer.concat([this.#buffer, Buffer.from(chunk)])
      : Buffer.from(chunk);

    for (;;) {
      const sync = this.#buffer.indexOf(SYNC_BYTE);
      if (sync === -1) {
        if (this.#buffer.length) {
          this.#onDiscard(this.#buffer.length, 'no sync byte');
        }
        this.#buffer = Buffer.alloc(0);
        return;
      }
      if (sync > 0) {
        this.#onDiscard(sync, 'bytes before the sync byte');
        this.#buffer = this.#buffer.subarray(sync);
      }
      if (this.#buffer.length < 6) {
        return;
      }
      if (crc8(this.#buffer, 1, 5) !== this.#buffer[5]) {
        // Not a header: this 0x55 was payload. Look for the next one.
        this.#onDiscard(1, 'header CRC');
        this.#buffer = this.#buffer.subarray(1);
        continue;
      }
      const dataLength = this.#buffer.readUInt16BE(1);
      const optionalLength = this.#buffer[3];
      const total = 7 + dataLength + optionalLength;
      if (this.#buffer.length < total) {
        return;
      }
      if (crc8(this.#buffer, 6, total - 1) !== this.#buffer[total - 1]) {
        this.#onDiscard(1, 'data CRC');
        this.#buffer = this.#buffer.subarray(1);
        continue;
      }
      const packet = {
        type: this.#buffer[4],
        data: Buffer.from(this.#buffer.subarray(6, 6 + dataLength)),
        optional: Buffer.from(this.#buffer.subarray(6 + dataLength, total - 1)),
      };
      this.#buffer = this.#buffer.subarray(total);
      this.#onPacket(packet);
    }
  }
}
