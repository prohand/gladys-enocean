// Test doubles: a socket that plays the EnOcean module, and a gateway that
// records what the runtime sends.

import { EventEmitter } from 'node:events';
import { Esp3Parser, PACKET_TYPES, encodePacket } from '../../src/enocean/esp3.js';
import { encodeErp1, decodeErp1 } from '../../src/enocean/telegram.js';

/**
 * A net.Socket stand-in wired to a fake USB 300: it answers CO_RD_VERSION and
 * CO_RD_IDBASE, and OK to every radio packet.
 */
export class FakeModuleSocket extends EventEmitter {
  written = [];
  destroyed = false;
  baseId = 'FF8A1C00';
  answer = true;

  constructor() {
    super();
    this.parser = new Esp3Parser((packet) => this.#onPacket(packet));
  }

  write(bytes) {
    this.written.push(Buffer.from(bytes));
    this.parser.push(bytes);
  }

  destroy() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    queueMicrotask(() => this.emit('close'));
  }

  /** Radio telegrams the gateway sent, decoded. */
  get sentTelegrams() {
    return this.packets.filter((p) => p.type === PACKET_TYPES.RADIO_ERP1).map(decodeErp1);
  }

  packets = [];

  #onPacket(packet) {
    this.packets.push(packet);
    if (!this.answer) {
      return;
    }
    let data = Buffer.from([0x00]);
    if (packet.type === PACKET_TYPES.COMMON_COMMAND && packet.data[0] === 0x08) {
      data = Buffer.concat([
        Buffer.from([0x00]),
        Buffer.from(this.baseId, 'hex'),
        Buffer.from([10]),
      ]);
    } else if (packet.type === PACKET_TYPES.COMMON_COMMAND && packet.data[0] === 0x03) {
      const description = Buffer.alloc(16);
      description.write('GATEWAYCTRL', 'latin1');
      data = Buffer.concat([
        Buffer.from([0x00, 2, 11, 1, 0, 2, 6, 3, 0]),
        Buffer.from('0181A2B3', 'hex'),
        Buffer.from([0x45, 0x4f, 0x03, 0x03]),
        description,
      ]);
    }
    queueMicrotask(() => this.emit('data', encodePacket(PACKET_TYPES.RESPONSE, data)));
  }

  /** The module heard a telegram. */
  hear({ rorg, payload, senderId, status = 0, dbm = 70 }) {
    const { data } = encodeErp1({ rorg, payload, senderId, status });
    const optional = Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, dbm, 0x00]);
    this.emit('data', encodePacket(PACKET_TYPES.RADIO_ERP1, data, optional));
  }
}

/** A Gateway stand-in for the runtime tests. */
export class FakeGateway extends EventEmitter {
  state = 'disconnected';
  baseId = 'FF8A1C00';
  version = { app: '2.11.1.0', api: '2.6.3.0', chipId: '0181A2B3', description: 'GATEWAYCTRL' };
  lastError = null;
  telegramCount = 0;
  sent = [];
  started = false;
  fail = null;

  constructor({ host, port }) {
    super();
    this.address = `${host}:${port}`;
  }

  get connected() {
    return this.state === 'connected';
  }

  start() {
    this.started = true;
  }

  stop() {
    this.started = false;
  }

  setState(state) {
    this.state = state;
    this.emit('status', state);
  }

  async sendTelegram(telegram, channel) {
    if (this.fail) {
      throw this.fail;
    }
    this.sent.push({ ...telegram, payload: [...telegram.payload], channel });
  }
}

/** Telegram as decodeErp1 returns it. */
export function telegram({ rorg, payload, senderId, status = 0, dbm = -70 }) {
  return {
    rorg,
    payload: Buffer.from(payload),
    senderId,
    status,
    dbm,
    destinationId: 'FFFFFFFF',
    subTelegrams: 1,
  };
}
