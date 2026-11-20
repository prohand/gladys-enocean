// -----------------------------------------------------------------------------
// ERP1 radio telegrams, as carried by an ESP3 RADIO_ERP1 packet.
//
//   data:     RORG (1) | user data (n) | sender id (4) | status (1)
//   optional: sub-telegrams (1) | destination id (4) | dBm (1) | security (1)
//
// An EnOcean id is 32 bits, written here as 8 upper-case hex digits
// ("0194E3B2"): the form printed on the devices and in every vendor tool.
// -----------------------------------------------------------------------------

/** Radio ORGanization: the telegram family, first byte of the data. */
export const RORG = {
  RPS: 0xf6, // repeated switch: rocker switches, window handles (1 byte)
  BS1: 0xd5, // 1 byte: contacts
  BS4: 0xa5, // 4 bytes: most sensors, Eltako central commands
  VLD: 0xd2, // variable length: D2-01 actuators...
  UTE: 0xd4, // universal teach-in
};

export const RORG_NAMES = {
  [RORG.RPS]: 'RPS',
  [RORG.BS1]: '1BS',
  [RORG.BS4]: '4BS',
  [RORG.VLD]: 'VLD',
  [RORG.UTE]: 'UTE',
};

export const BROADCAST_ID = 'FFFFFFFF';

const ID_PATTERN = /^[0-9A-F]{8}$/;

/**
 * Normalize an EnOcean id typed by a user: "01:94:e3:b2", "0x0194E3B2",
 * "0194e3b2" all read "0194E3B2". Returns null when it is not 32 bits of hex.
 * @param {unknown} value
 */
export function normalizeId(value) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }
  const hex = String(value)
    .trim()
    .replace(/^0x/i, '')
    .replace(/[\s:.-]/g, '')
    .toUpperCase();
  return ID_PATTERN.test(hex) ? hex : null;
}

/** @param {Uint8Array} bytes 4 bytes */
export function formatId(bytes) {
  return Buffer.from(bytes).toString('hex').toUpperCase();
}

/** @param {string} id 8 hex digits */
export function idToBytes(id) {
  return Buffer.from(id, 'hex');
}

/** `base + offset` as an id: the sender ids a gateway may use. */
export function addToId(id, offset) {
  const value = (parseInt(id, 16) + offset) >>> 0;
  return value.toString(16).toUpperCase().padStart(8, '0');
}

/**
 * Decode the RADIO_ERP1 packet of an ESP3 frame.
 * @param {{ data: Buffer, optional: Buffer }} packet
 * @returns {null | {
 *   rorg: number, payload: Buffer, senderId: string, status: number,
 *   destinationId: string | null, dbm: number | null, subTelegrams: number | null,
 * }}
 */
export function decodeErp1({ data, optional }) {
  // RORG + at least one byte of user data + sender + status.
  if (data.length < 7) {
    return null;
  }
  const hasOptional = optional && optional.length >= 6;
  return {
    rorg: data[0],
    payload: Buffer.from(data.subarray(1, data.length - 5)),
    senderId: formatId(data.subarray(data.length - 5, data.length - 1)),
    status: data[data.length - 1],
    subTelegrams: hasOptional ? optional[0] : null,
    destinationId: hasOptional ? formatId(optional.subarray(1, 5)) : null,
    // The module reports the best signal as a positive number: 0x4F is -79 dBm.
    dbm: hasOptional ? -optional[5] : null,
  };
}

/**
 * Build the data and optional parts of a RADIO_ERP1 packet to send.
 * @param {{ rorg: number, payload: Uint8Array, senderId: string, status?: number, destinationId?: string }} telegram
 */
export function encodeErp1({ rorg, payload, senderId, status = 0, destinationId = BROADCAST_ID }) {
  const data = Buffer.concat([
    Buffer.from([rorg]),
    Buffer.from(payload),
    idToBytes(senderId),
    Buffer.from([status]),
  ]);
  // Send 3 sub-telegrams (the module's own default), best dBm 0xFF on send,
  // no security.
  const optional = Buffer.concat([
    Buffer.from([0x03]),
    idToBytes(destinationId),
    Buffer.from([0xff, 0x00]),
  ]);
  return { data, optional };
}

/**
 * Teach-in information carried by a telegram, or null for a data telegram.
 *
 * - 4BS: LRN bit (DB0.3) at 0. With the LRN type bit (DB0.7) set, the
 *   telegram also names its profile: FUNC, TYPE and the manufacturer.
 * - 1BS: LRN bit (DB0.3) at 0, no profile carried.
 * - UTE: a teach-in query of a bidirectional device (D2-01 plugs...).
 *
 * @param {{ rorg: number, payload: Buffer }} telegram
 * @returns {null | { kind: '4BS' | '1BS' | 'UTE', eep: string | null, manufacturer: number | null, query?: Buffer, request?: string, channels?: number }}
 */
export function teachInInfo({ rorg, payload }) {
  if (rorg === RORG.BS4 && payload.length === 4 && (payload[3] & 0x08) === 0) {
    if ((payload[3] & 0x80) === 0) {
      return { kind: '4BS', eep: null, manufacturer: null };
    }
    const func = payload[0] >> 2;
    const type = ((payload[0] & 0x03) << 5) | (payload[1] >> 3);
    const manufacturer = ((payload[1] & 0x07) << 8) | payload[2];
    return { kind: '4BS', eep: formatEep(0xa5, func, type), manufacturer };
  }
  if (rorg === RORG.BS1 && payload.length === 1 && (payload[0] & 0x08) === 0) {
    return { kind: '1BS', eep: null, manufacturer: null };
  }
  if (rorg === RORG.UTE && payload.length === 7 && (payload[0] & 0x0f) === 0x00) {
    const requests = ['teach-in', 'deletion', 'either'];
    return {
      kind: 'UTE',
      eep: formatEep(payload[6], payload[5], payload[4]),
      manufacturer: ((payload[3] & 0x07) << 8) | payload[2],
      channels: payload[1],
      request: requests[(payload[0] >> 4) & 0x03] ?? 'either',
      // Bit 6 at 0: the device waits for an answer.
      expectsResponse: (payload[0] & 0x40) === 0,
      query: Buffer.from(payload),
    };
  }
  return null;
}

/**
 * The UTE answer to a teach-in query: same 6 bytes after the first, the first
 * one saying "bidirectional, request accepted, this is a response".
 * @param {Buffer} query the 7 bytes of the query
 * @param {'teach-in' | 'deletion' | 'refused'} result
 */
export function uteResponse(query, result) {
  const codes = { refused: 0b00, 'teach-in': 0b01, deletion: 0b10 };
  const response = Buffer.from(query);
  response[0] = 0x80 | (codes[result] << 4) | 0x01;
  return response;
}

/** "A5-02-05" from its three numbers. */
export function formatEep(rorg, func, type) {
  return [rorg, func, type].map((n) => n.toString(16).toUpperCase().padStart(2, '0')).join('-');
}
