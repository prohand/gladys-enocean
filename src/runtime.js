// -----------------------------------------------------------------------------
// The running integration: one gateway, the declared devices, and what goes
// between them and Gladys.
//
//   telegram heard  -> remembered (heard.js), decoded by the device profile,
//                      published as states, scene events fired
//   Gladys order    -> telegrams sent from the device channel
//   UTE teach-in    -> answered during learn mode, or for a declared device
//
// index.js only wires the SDK to this class; the tests drive it with the fake
// Gladys of the SDK and a fake gateway.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { parseDevices } from './config.js';
import {
  buildDiscoveredDevices,
  buildTransportEntries,
  deviceIds,
  featureKey,
  findDevice,
} from './devices.js';
import { BUTTON_STATUS, ROCKER_BUTTONS, rockerPress } from './enocean/eep.js';
import { Gateway } from './enocean/gateway.js';
import { HeardList } from './enocean/heard.js';
import { RockerTracker } from './enocean/rocker.js';
import { RORG, teachInInfo, uteResponse } from './enocean/telegram.js';

const logger = createLogger({ name: 'enocean' });

/** Scene trigger keys, as declared in the manifest `scene_triggers`. Forever. */
export const TRIGGERS = {
  ROCKER_PRESSED: 'rocker_pressed',
  WINDOW_HANDLE_MOVED: 'window_handle_moved',
  UNKNOWN_DEVICE_HEARD: 'unknown_device_heard',
  GATEWAY_DISCONNECTED: 'gateway_disconnected',
};

/** An unknown emitter fires its trigger at most once in this delay. */
export const UNKNOWN_TRIGGER_COOLDOWN_MS = 60 * 60 * 1000;
export const MAX_LEARN_SECONDS = 600;
const TRANSPORT_BATCH = 100;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class EnOceanRuntime {
  gladys;
  config = null;
  devices = [];
  configErrors = [];
  gateway = null;
  heard;
  learnUntil = 0;
  learned = [];

  #createGateway;
  #now;
  #rockers;
  #handles = new Map();
  #unknownFiredAt = new Map();
  #learnTimer = null;
  #wasConnected = false;
  #onChange;

  /**
   * @param {object} gladys the SDK client
   * @param {{ createGateway?: (options: { host: string, port: number }) => Gateway, now?: () => number, onChange?: () => void }} [options]
   */
  constructor(
    gladys,
    { createGateway = (options) => new Gateway(options), now = Date.now, onChange = () => {} } = {},
  ) {
    this.gladys = gladys;
    this.#createGateway = createGateway;
    this.#now = now;
    this.#onChange = onChange;
    this.heard = new HeardList(now);
    this.#rockers = new RockerTracker((click) => this.#onRockerClick(click), now);
  }

  get learning() {
    return this.learnUntil > this.#now();
  }

  // ----------------------------------------------------------- lifecycle --

  /**
   * Apply a (new) configuration: re-read the device list, publish it, and
   * reconnect the gateway when its address changed.
   */
  async applyConfig(config) {
    this.config = config;
    const { devices, errors } = parseDevices(config.devices);
    this.devices = devices;
    this.configErrors = errors;
    for (const error of errors) {
      logger.warn(`Device list: ${error}`);
    }
    logger.info(`${devices.length} device(s) declared`);

    const address = `${config.gateway_host}:${config.gateway_port}`;
    if (this.gateway && this.gateway.address !== address) {
      this.gateway.removeAllListeners();
      this.gateway.stop();
      this.gateway = null;
    }
    if (!this.gateway && config.gateway_host && config.gateway_port) {
      this.gateway = this.#createGateway({
        host: config.gateway_host,
        port: config.gateway_port,
      });
      this.gateway.on('telegram', (telegram) => {
        this.handleTelegram(telegram).catch((err) => logger.error('Telegram handling failed', err));
      });
      this.gateway.on('status', (state) => {
        this.#onGatewayStatus(state).catch((err) =>
          logger.error('Gateway status handling failed', err),
        );
      });
      this.gateway.start();
    }

    await this.gladys.publishDiscoveredDevices(buildDiscoveredDevices(this.gladys, devices));
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.#onChange();
  }

  stop() {
    clearTimeout(this.#learnTimer);
    this.#rockers.clear();
    if (this.gateway) {
      this.gateway.removeAllListeners();
      this.gateway.stop();
      this.gateway = null;
    }
  }

  async #onGatewayStatus(state) {
    if (state === 'connected') {
      this.#wasConnected = true;
      // States may have changed while nobody listened: ask the addressed
      // actuators for theirs.
      await this.#queryActuators();
    } else if (state === 'disconnected' && this.#wasConnected) {
      this.#wasConnected = false;
      await this.#fire(TRIGGERS.GATEWAY_DISCONNECTED, {
        address: this.gateway?.address ?? '',
        reason: this.gateway?.lastError ?? 'closed',
      });
    }
    if (state !== 'connecting') {
      await this.publishTransports();
      await this.publishConnectionStatus();
    }
    this.#onChange();
  }

  async publishTransports() {
    const entries = buildTransportEntries(
      this.gladys,
      this.devices,
      Boolean(this.gateway?.connected),
    );
    for (let i = 0; i < entries.length; i += TRANSPORT_BATCH) {
      try {
        await this.gladys.publishTransports(entries.slice(i, i + TRANSPORT_BATCH));
      } catch (err) {
        logger.warn(`Transport badges refused: ${err.message}`);
      }
    }
  }

  async publishConnectionStatus() {
    try {
      if (!this.config?.gateway_host) {
        await this.gladys.setConnectionStatus(false, {
          en: 'Enter the address of your EnOcean gateway.',
          fr: "Indiquez l'adresse de votre passerelle EnOcean.",
          de: 'Gib die Adresse deines EnOcean-Gateways ein.',
          es: 'Indique la dirección de su pasarela EnOcean.',
        });
      } else if (this.gateway?.connected) {
        await this.gladys.setConnectionStatus(true);
      } else {
        const address = this.gateway?.address ?? this.config.gateway_host;
        await this.gladys.setConnectionStatus(false, {
          en: `EnOcean gateway ${address} unreachable, retrying.`,
          fr: `Passerelle EnOcean ${address} injoignable, nouvel essai en cours.`,
          de: `EnOcean-Gateway ${address} nicht erreichbar, neuer Versuch läuft.`,
          es: `Pasarela EnOcean ${address} inaccesible, reintentando.`,
        });
      }
    } catch (err) {
      logger.warn(`Connection status refused: ${err.message}`);
    }
  }

  // ------------------------------------------------------------ receive ----

  /** Everything the gateway hears comes through here. */
  async handleTelegram(telegram) {
    const heard = this.heard.record(telegram);
    const devices = this.devices.filter((device) => device.id === telegram.senderId);
    const teachIn = teachInInfo(telegram);
    logger.debug(
      `Heard ${telegram.senderId} ${heard.rorg} ${telegram.payload.toString('hex')}` +
        ` ${telegram.dbm ?? '?'} dBm${teachIn ? ` (teach-in ${teachIn.eep ?? ''})` : ''}`,
    );

    if (teachIn) {
      await this.#onTeachIn(telegram, teachIn, devices);
      return;
    }

    if (devices.length === 0) {
      await this.#onUnknown(heard);
      return;
    }

    for (const device of devices) {
      const decoded = device.profile.decode(telegram, device);
      if (!decoded) {
        logger.debug(`${device.name} (${device.eep}): telegram not for this profile, ignored`);
        continue;
      }
      await this.#publish(device, decoded.states);
      if (decoded.rocker) {
        this.#rockers.handle(device.key, decoded.rocker);
      }
      if (decoded.handle) {
        await this.#onHandle(device, decoded.handle);
      }
    }
  }

  async #publish(device, states) {
    const entries = Object.entries(states ?? {});
    if (entries.length === 0) {
      return;
    }
    const ids = deviceIds(this.gladys, device);
    try {
      await this.gladys.publishStates(
        entries.map(([key, state]) => ({ device_feature_external_id: ids.feature(key), state })),
      );
    } catch (err) {
      logger.warn(`${device.name}: states refused by Gladys: ${err.message}`);
    }
  }

  async #onUnknown(heard) {
    if (!this.config?.unknown_devices_trigger) {
      return;
    }
    const lastFired = this.#unknownFiredAt.get(heard.id);
    if (lastFired !== undefined && this.#now() - lastFired < UNKNOWN_TRIGGER_COOLDOWN_MS) {
      return;
    }
    this.#unknownFiredAt.set(heard.id, this.#now());
    await this.#fire(TRIGGERS.UNKNOWN_DEVICE_HEARD, {
      sender_id: heard.id,
      eep: heard.eep ?? '',
      rorg: heard.rorg,
      dbm: heard.dbm ?? 0,
      teach_in: heard.teachIn,
    });
  }

  async #onTeachIn(telegram, teachIn, devices) {
    if (teachIn.kind !== 'UTE') {
      if (this.learning && !this.learned.includes(telegram.senderId)) {
        this.learned.push(telegram.senderId);
        logger.info(`Learned ${telegram.senderId} (${teachIn.eep ?? 'profile not sent'})`);
        this.#onChange();
      }
      if (devices.length === 0) {
        await this.#onUnknown(this.heard.get(telegram.senderId));
      }
      return;
    }
    // A bidirectional device asks to be paired and waits for our answer. It
    // is given the channel declared for it, or channel 0 during learn mode.
    const declared = devices.find((device) => device.channel !== null);
    if (!declared && !this.learning) {
      logger.info(
        `${telegram.senderId} asks to be paired (${teachIn.eep}): open the learn mode to accept`,
      );
      await this.#onUnknown(this.heard.get(telegram.senderId));
      return;
    }
    if (!teachIn.expectsResponse) {
      return;
    }
    const channel = declared?.channel ?? 0;
    const result = teachIn.request === 'deletion' ? 'deletion' : 'teach-in';
    try {
      await this.gateway.sendTelegram(
        {
          rorg: RORG.UTE,
          payload: [...uteResponse(teachIn.query, result)],
          destinationId: telegram.senderId,
        },
        channel,
      );
      logger.info(`Paired ${telegram.senderId} (${teachIn.eep}) on channel ${channel}`);
      if (!this.learned.includes(telegram.senderId)) {
        this.learned.push(telegram.senderId);
      }
      this.#onChange();
    } catch (err) {
      logger.warn(`Could not answer the teach-in of ${telegram.senderId}: ${err.message}`);
    }
  }

  async #onRockerClick({ key, buttons, press, durationMs }) {
    const device = this.devices.find((candidate) => candidate.key === key);
    if (!device) {
      return;
    }
    const value = press === 'long' ? BUTTON_STATUS.LONG_CLICK : BUTTON_STATUS.CLICK;
    await this.#publish(device, Object.fromEntries(buttons.map((button) => [button, value])));
    for (const button of buttons) {
      await this.#fire(TRIGGERS.ROCKER_PRESSED, {
        device: deviceIds(this.gladys, device).device,
        device_name: device.name,
        button,
        press,
        duration_ms: durationMs ?? 0,
      });
    }
  }

  async #onHandle(device, position) {
    if (this.#handles.get(device.key) === position) {
      return; // repeated telegram, the handle did not move
    }
    this.#handles.set(device.key, position);
    await this.#fire(TRIGGERS.WINDOW_HANDLE_MOVED, {
      device: deviceIds(this.gladys, device).device,
      device_name: device.name,
      position,
    });
  }

  async #fire(trigger, data) {
    try {
      await this.gladys.publishSceneEvent(trigger, data);
    } catch (err) {
      logger.warn(`Scene event ${trigger} refused: ${err.message}`);
    }
  }

  // --------------------------------------------------------------- send ---

  async #send(telegrams, device) {
    if (!this.gateway) {
      throw new Error('No EnOcean gateway configured');
    }
    for (const { delayMs, ...telegram } of telegrams) {
      if (delayMs) {
        await wait(delayMs);
      }
      await this.gateway.sendTelegram(
        { ...telegram, ...(device.profile.addressed && { destinationId: device.id }) },
        device.channel,
      );
    }
  }

  /** onSetValue: a Gladys order on a feature. */
  async setValue(externalId, featureExternalId, value) {
    const device = findDevice(this.gladys, this.devices, externalId);
    if (!device) {
      throw new Error(`Unknown device ${externalId}: is it still in the device list?`);
    }
    const key = featureKey(this.gladys, device, featureExternalId);
    const telegrams = device.profile.command?.(key, value, device);
    if (!telegrams) {
      throw new Error(`${device.name}: "${key}" cannot be set`);
    }
    await this.#send(telegrams, device);
    // Show the order at once; an actuator with feedback corrects it if needed.
    const states = { [key]: value };
    if (key === 'brightness') {
      states.switch = value > 0 ? 1 : 0;
    }
    await this.#publish(device, states);
  }

  async #queryActuators() {
    for (const device of this.devices) {
      const telegrams = device.profile.query?.(device);
      if (!telegrams) {
        continue;
      }
      try {
        await this.#send(telegrams, device);
      } catch (err) {
        logger.debug(`${device.name}: status query failed: ${err.message}`);
      }
    }
  }

  /**
   * Send the teach-in telegram of an actuator, the one it learns while in
   * learn mode. Resolves false when the profile pairs from the device side.
   */
  async teachIn(externalId) {
    const device = findDevice(this.gladys, this.devices, externalId);
    if (!device) {
      throw new Error(`Unknown device ${externalId}`);
    }
    const telegrams = device.profile.teachIn?.(device);
    if (!telegrams) {
      return { device, sent: false };
    }
    await this.#send(telegrams, device);
    return { device, sent: true };
  }

  /** Press a button of the virtual rocker of a channel. */
  async pressRocker(channel, button, long = false) {
    const code = ROCKER_BUTTONS.indexOf(button);
    if (code === -1) {
      throw new Error(`Unknown button "${button}"`);
    }
    const [press, release] = rockerPress(code);
    await this.#send([press, { ...release, delayMs: long ? 1500 : release.delayMs }], {
      channel,
      profile: {},
    });
  }

  /** Accept teach-ins for `seconds`, and remember who was learned. */
  startLearnMode(seconds) {
    const duration = Math.max(10, Math.min(MAX_LEARN_SECONDS, Math.round(seconds || 60)));
    clearTimeout(this.#learnTimer);
    this.learned = [];
    this.learnUntil = this.#now() + duration * 1000;
    this.#learnTimer = setTimeout(() => {
      this.learnUntil = 0;
      logger.info(`Learn mode closed, ${this.learned.length} device(s) learned`);
      this.#onChange();
    }, duration * 1000);
    this.#learnTimer.unref?.();
    logger.info(`Learn mode open for ${duration} s`);
    this.#onChange();
    return duration;
  }
}
