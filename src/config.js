// -----------------------------------------------------------------------------
// Configuration: defaults, normalization and the device list.
//
// The defaults MUST stay consistent with the `default` values of the manifest
// `config_schema` (test/manifest.test.js checks it).
//
// EnOcean has no discovery: a sensor only says "I am 0194E3B2", never what it
// measures. The user declares each device in the `devices` field, as a JSON
// list (the "Devices heard" action writes the lines for them):
//
//   [
//     { "id": "0194E3B2", "eep": "A5-02-05", "name": "Living room" },
//     { "id": "FEF1A2B3", "eep": "F6-02-01", "name": "Entrance switch" },
//     { "eep": "A5-38-08", "channel": 1, "name": "Kitchen dimmer", "dimmable": true },
//     { "id": "05123456", "eep": "D2-01-12", "channel": 2, "name": "Plug" }
//   ]
// -----------------------------------------------------------------------------

import { findProfile } from './enocean/eep.js';
import { normalizeId } from './enocean/telegram.js';

export const DEFAULT_CONFIG = {
  gateway_host: '',
  gateway_port: 9999,
  devices: '',
  unknown_devices_trigger: true,
  debug_logs: false,
};

/** Channels a gateway may send from: its base id plus 0 to 127. */
export const MAX_CHANNEL = 127;

/**
 * Merge the user config with the defaults, and force the types: a form may
 * send numbers as strings.
 * @param {Record<string, unknown>} raw
 */
export function normalizeConfig(raw = {}) {
  const port = Number(raw.gateway_port ?? DEFAULT_CONFIG.gateway_port);
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    gateway_host: String(raw.gateway_host ?? '').trim(),
    gateway_port: Number.isInteger(port) && port > 0 && port < 65536 ? port : null,
    devices: typeof raw.devices === 'string' ? raw.devices : '',
    unknown_devices_trigger: raw.unknown_devices_trigger !== false,
    debug_logs: raw.debug_logs === true,
  };
}

/**
 * Read the `devices` field.
 *
 * Tolerant on purpose: a bare list, `{ "devices": [...] }`, a single object,
 * or one JSON object per line (what "Devices heard" prints) are all read. A
 * wrong entry is reported and skipped; it never takes the others down.
 *
 * @param {string} text
 * @returns {{ devices: object[], errors: string[] }}
 */
export function parseDevices(text) {
  const errors = [];
  const source = String(text ?? '').trim();
  if (!source) {
    return { devices: [], errors };
  }

  let entries;
  try {
    entries = readJson(source);
  } catch (err) {
    return { devices: [], errors: [`The device list is not valid JSON: ${err.message}`] };
  }

  const devices = [];
  const keys = new Set();
  entries.forEach((entry, index) => {
    const result = normalizeDevice(entry, index);
    if (result.error) {
      errors.push(result.error);
      return;
    }
    const { device } = result;
    if (keys.has(device.key)) {
      errors.push(`Entry ${index + 1} (${device.name}): declared twice, ignored.`);
      return;
    }
    keys.add(device.key);
    devices.push(device);
  });
  return { devices, errors };
}

function readJson(source) {
  try {
    const parsed = JSON.parse(source);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (Array.isArray(parsed?.devices)) {
      return parsed.devices;
    }
    return [parsed];
  } catch (err) {
    // One object per line, maybe with trailing commas: what people paste.
    const lines = source
      .split('\n')
      .map((line) => line.trim().replace(/,$/, ''))
      .filter((line) => line && line !== '[' && line !== ']');
    if (lines.length < 2) {
      throw err;
    }
    return lines.map((line) => JSON.parse(line));
  }
}

function normalizeDevice(entry, index) {
  const where = `Entry ${index + 1}`;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return { error: `${where}: not an object, ignored.` };
  }
  const eep = String(entry.eep ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s:]/g, '-');
  const id = entry.id === undefined || entry.id === null ? null : normalizeId(entry.id);
  if (entry.id !== undefined && entry.id !== null && !id) {
    return { error: `${where}: "${entry.id}" is not an EnOcean id (8 hex digits), ignored.` };
  }
  const channel = readChannel(entry.channel);
  if (channel === undefined) {
    return {
      error: `${where}: channel must be a whole number from 0 to ${MAX_CHANNEL}, ignored.`,
    };
  }

  const profile = findProfile(eep, { channel });
  if (!profile) {
    return { error: `${where}: profile "${entry.eep}" is not supported, ignored.` };
  }
  const name = String(entry.name ?? '').trim() || `EnOcean ${id ?? `channel ${channel}`}`;

  if (profile.role === 'sensor' && !id) {
    return { error: `${where} (${name}): a ${eep} needs its "id", ignored.` };
  }
  if (profile.role === 'actuator' && channel === null) {
    return { error: `${where} (${name}): a ${eep} needs a "channel" (0-${MAX_CHANNEL}), ignored.` };
  }
  if (profile.addressed && !id) {
    return { error: `${where} (${name}): a ${eep} needs its "id", ignored.` };
  }

  const io = Number.isInteger(entry.io) && entry.io >= 0 && entry.io <= 29 ? entry.io : 0;
  const rocker = String(entry.rocker ?? 'a').toLowerCase() === 'b' ? 'b' : 'a';

  // The identity Gladys keys the device on, forever: the radio id when the
  // device has one, the channel for a relay that only listens to Gladys.
  let key;
  if (profile.role === 'sensor' || profile.addressed) {
    key = io > 0 ? `${id}-io${io}` : id;
  } else {
    key = `ch${channel}`;
  }

  return {
    device: {
      key: key.toLowerCase(),
      id,
      eep,
      name,
      channel,
      io,
      rocker,
      dimmable: entry.dimmable === true,
      profile,
    },
  };
}

/** null when absent, undefined when invalid. */
function readChannel(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const channel = Number(value);
  return Number.isInteger(channel) && channel >= 0 && channel <= MAX_CHANNEL ? channel : undefined;
}
