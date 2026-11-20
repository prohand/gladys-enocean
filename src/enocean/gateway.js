// -----------------------------------------------------------------------------
// The EnOcean gateway, reached over TCP.
//
// The integration runs in a sandboxed container that sees no USB device: the
// USB 300 (or any ESP3 module) is exposed on the network by ser2net, a
// Raspberry Pi, an ESP32 serial bridge... — a raw TCP socket carrying the
// serial bytes at 57600 bauds. This module:
//
//   - opens that socket, and reopens it after a loss (1 s, 2 s, 5 s, 10 s,
//     then every 30 s), forever: a gateway rebooting is not an error;
//   - reads the module's version and base id once connected;
//   - sends one ESP3 packet at a time and waits for its RESPONSE: the module
//     answers every packet in order, and two packets in flight would make
//     one answer look like the other's;
//   - emits 'telegram' for every radio telegram heard, 'status' on every
//     change of connection state.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import net from 'node:net';
import { createLogger } from '@gladysassistant/integration-sdk';
import { COMMON_COMMANDS, Esp3Parser, PACKET_TYPES, RETURN_CODES, encodePacket } from './esp3.js';
import { addToId, decodeErp1, encodeErp1, formatId } from './telegram.js';

const logger = createLogger({ name: 'gateway' });

export const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000, 30000];
export const RESPONSE_TIMEOUT_MS = 2000;
const CONNECT_TIMEOUT_MS = 10000;

export class GatewayError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

export class Gateway extends EventEmitter {
  #host;
  #port;
  #createConnection;
  #socket = null;
  #parser;
  #stopped = true;
  #attempt = 0;
  #reconnectTimer = null;
  #queue = Promise.resolve();
  #pending = null;

  /** 'disconnected' | 'connecting' | 'connected' */
  state = 'disconnected';
  baseId = null;
  version = null;
  lastError = null;
  connectedAt = null;
  telegramCount = 0;

  /**
   * @param {{ host: string, port: number, createConnection?: typeof net.createConnection }} options
   */
  constructor({ host, port, createConnection = net.createConnection }) {
    super();
    this.#host = host;
    this.#port = port;
    this.#createConnection = createConnection;
    this.#parser = new Esp3Parser(
      (packet) => this.#onPacket(packet),
      (bytes, reason) => logger.debug(`Dropped ${bytes} byte(s): ${reason}`),
    );
  }

  get address() {
    return `${this.#host}:${this.#port}`;
  }

  get connected() {
    return this.state === 'connected';
  }

  start() {
    if (!this.#stopped) {
      return;
    }
    this.#stopped = false;
    this.#connect();
  }

  stop() {
    this.#stopped = true;
    clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
    this.#socket?.destroy();
    this.#socket = null;
    this.#setState('disconnected');
  }

  #connect() {
    this.#setState('connecting');
    logger.info(`Connecting to the EnOcean gateway at ${this.address}`);
    this.#parser.reset();
    const socket = this.#createConnection({ host: this.#host, port: this.#port });
    this.#socket = socket;
    socket.setTimeout?.(CONNECT_TIMEOUT_MS);
    socket.setNoDelay?.(true);

    socket.on('connect', () => {
      socket.setTimeout?.(0);
      socket.setKeepAlive?.(true, 30000);
      this.#attempt = 0;
      this.lastError = null;
      this.connectedAt = Date.now();
      this.#initialize(socket);
    });
    socket.on('timeout', () => {
      socket.destroy(new Error(`no answer from ${this.address} within ${CONNECT_TIMEOUT_MS} ms`));
    });
    socket.on('data', (chunk) => this.#parser.push(chunk));
    socket.on('error', (err) => {
      this.lastError = err.code ?? err.message;
      logger.warn(`Gateway ${this.address}: ${err.message}`);
    });
    socket.on('close', () => {
      if (this.#socket !== socket) {
        return;
      }
      this.#socket = null;
      this.#rejectPending(new GatewayError('connection lost', 'DISCONNECTED'));
      if (this.#stopped) {
        return;
      }
      this.#setState('disconnected');
      const delay = RECONNECT_DELAYS_MS[Math.min(this.#attempt, RECONNECT_DELAYS_MS.length - 1)];
      this.#attempt += 1;
      logger.info(`Gateway ${this.address} closed, reconnecting in ${delay / 1000} s`);
      this.#reconnectTimer = setTimeout(() => this.#connect(), delay);
    });
  }

  async #initialize(socket) {
    try {
      this.version = await this.readVersion();
    } catch (err) {
      // Some bridges only relay radio: not knowing the version is no reason
      // to refuse what they hear.
      logger.warn(`Could not read the module version: ${err.message}`);
    }
    try {
      this.baseId = await this.readBaseId();
      logger.info(`Gateway connected, base id ${this.baseId}`);
    } catch (err) {
      this.baseId = null;
      logger.warn(`Could not read the base id, sending is disabled: ${err.message}`);
    }
    if (this.#socket === socket) {
      this.#setState('connected');
    }
  }

  #setState(state) {
    if (this.state === state) {
      return;
    }
    this.state = state;
    if (state !== 'connected') {
      this.connectedAt = state === 'connecting' ? this.connectedAt : null;
    }
    this.emit('status', state);
  }

  #onPacket(packet) {
    if (packet.type === PACKET_TYPES.RESPONSE) {
      const pending = this.#pending;
      if (!pending) {
        logger.debug('Response received with no request waiting for it');
        return;
      }
      this.#pending = null;
      clearTimeout(pending.timer);
      pending.resolve(packet);
      return;
    }
    if (packet.type === PACKET_TYPES.RADIO_ERP1) {
      const telegram = decodeErp1(packet);
      if (!telegram) {
        logger.debug('Radio packet too short, ignored');
        return;
      }
      this.telegramCount += 1;
      this.emit('telegram', telegram);
      return;
    }
    logger.debug(`Packet type 0x${packet.type.toString(16)} ignored`);
  }

  #rejectPending(err) {
    const pending = this.#pending;
    this.#pending = null;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
  }

  /**
   * Send one packet and resolve with its RESPONSE packet. Packets are sent one
   * at a time, in call order.
   */
  request(type, data, optional) {
    const run = () => this.#send(type, data, optional);
    const result = this.#queue.then(run, run);
    this.#queue = result.catch(() => {});
    return result;
  }

  #send(type, data, optional) {
    const socket = this.#socket;
    if (!socket || socket.destroyed || this.state === 'disconnected') {
      return Promise.reject(new GatewayError('gateway not connected', 'DISCONNECTED'));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending = null;
        reject(new GatewayError('no response from the module', 'TIMEOUT'));
      }, RESPONSE_TIMEOUT_MS);
      this.#pending = { resolve, reject, timer };
      socket.write(encodePacket(type, data, optional));
    });
  }

  /** Send a packet and fail unless the module answers OK. */
  async #command(type, data, optional) {
    const response = await this.request(type, data, optional);
    const code = response.data[0];
    if (code !== 0x00) {
      const name = RETURN_CODES[code] ?? `0x${code.toString(16)}`;
      throw new GatewayError(`the module answered ${name}`, name);
    }
    return response;
  }

  async readVersion() {
    const { data } = await this.#command(
      PACKET_TYPES.COMMON_COMMAND,
      Buffer.from([COMMON_COMMANDS.CO_RD_VERSION]),
    );
    if (data.length < 33) {
      throw new GatewayError('version answer too short', 'ERROR');
    }
    return {
      app: [...data.subarray(1, 5)].join('.'),
      api: [...data.subarray(5, 9)].join('.'),
      chipId: formatId(data.subarray(9, 13)),
      description: data.subarray(17, 33).toString('latin1').replace(/\0.*$/s, '').trim(),
    };
  }

  async readBaseId() {
    const { data } = await this.#command(
      PACKET_TYPES.COMMON_COMMAND,
      Buffer.from([COMMON_COMMANDS.CO_RD_IDBASE]),
    );
    if (data.length < 5) {
      throw new GatewayError('base id answer too short', 'ERROR');
    }
    return formatId(data.subarray(1, 5));
  }

  /** The sender id of a channel: base id + channel. */
  senderId(channel) {
    if (!this.baseId) {
      throw new GatewayError('the base id of the gateway is unknown', 'NO_BASE_ID');
    }
    return addToId(this.baseId, channel);
  }

  /**
   * Send one radio telegram from a channel of the gateway.
   * @param {{ rorg: number, payload: number[], status?: number, destinationId?: string }} telegram
   * @param {number} channel 0..127
   */
  async sendTelegram(telegram, channel) {
    const { data, optional } = encodeErp1({ ...telegram, senderId: this.senderId(channel) });
    await this.#command(PACKET_TYPES.RADIO_ERP1, data, optional);
  }
}
