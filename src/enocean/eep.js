// -----------------------------------------------------------------------------
// EnOcean Equipment Profiles (EEP): what the bytes of a telegram mean.
//
// A telegram does not say what it is: the same 4 bytes are a temperature for
// an A5-02-05 and a humidity for an A5-04-01. The user declares the profile
// of each device (it is printed on the device or in its manual), and this
// module turns telegrams into Gladys states — and Gladys orders into
// telegrams, for the actuators.
//
// Every profile exposes:
//   - eep, label            : the code, and a human description
//   - role                  : 'sensor' (listened to, needs the device `id`) or
//                             'actuator' (driven by Gladys from a gateway
//                             channel, see devices.js)
//   - features(device)      : the Gladys features, keyed by a stable `key`
//   - decode(telegram, dev) : { states: { key: value }, rocker?, handle? }
//                             or null when the telegram is not for it
//   - command(key, value, dev) (actuators): the telegrams to send
//   - teachIn(dev)          (actuators): the telegrams that pair it
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import { RORG } from './telegram.js';

// Gladys' BUTTON_STATUS values (server/utils/constants.js).
export const BUTTON_STATUS = { CLICK: 1, LONG_CLICK: 3 };

/** Rocker buttons, by their EEP code (F6-02, R1 field). O is the upper side. */
export const ROCKER_BUTTONS = ['ai', 'ao', 'bi', 'bo'];

const ROCKER_LABELS = {
  ai: 'Button A I',
  ao: 'Button A O',
  bi: 'Button B I',
  bo: 'Button B O',
};

/** F6-10-00 window handle positions. */
export const HANDLE_POSITIONS = ['closed', 'open', 'tilted'];

// ---------------------------------------------------------------- features --

function feature(key, name, category, type, extra = {}) {
  return {
    key,
    name,
    category,
    type,
    read_only: true,
    has_feedback: false,
    keep_history: true,
    min: 0,
    max: 1,
    ...extra,
  };
}

const temperature = (min, max) =>
  feature('temperature', 'Temperature', CATEGORIES.TEMPERATURE_SENSOR, TYPES.SENSOR.DECIMAL, {
    unit: UNITS.CELSIUS,
    min,
    max,
  });

const humidity = () =>
  feature('humidity', 'Humidity', CATEGORIES.HUMIDITY_SENSOR, TYPES.SENSOR.DECIMAL, {
    unit: UNITS.PERCENT,
    min: 0,
    max: 100,
  });

const illuminance = (max) =>
  feature('illuminance', 'Illuminance', CATEGORIES.LIGHT_SENSOR, TYPES.SENSOR.DECIMAL, {
    unit: UNITS.LUX,
    min: 0,
    max,
  });

const motion = () => feature('motion', 'Motion', CATEGORIES.MOTION_SENSOR, TYPES.SENSOR.BINARY);

const opening = (name = 'Contact') =>
  feature('contact', name, CATEGORIES.OPENING_SENSOR, TYPES.SENSOR.BINARY);

const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Linear scale of a raw value in [rawMin, rawMax] to [min, max]. */
const scale = (raw, rawMin, rawMax, min, max) =>
  min + ((raw - rawMin) * (max - min)) / (rawMax - rawMin);

const is4bsData = (telegram) =>
  telegram.rorg === RORG.BS4 && telegram.payload.length === 4 && (telegram.payload[3] & 0x08) !== 0;

// ----------------------------------------------------------- A5-02: temp. --

// FUNC 02, temperature sensors: TYPE -> [min, max] °C. The 8-bit types read
// DB1 inverted (255 is the minimum); 0x20 and 0x30 read 10 bits.
const A5_02_RANGES = {
  0x01: [-40, 0],
  0x02: [-30, 10],
  0x03: [-20, 20],
  0x04: [-10, 30],
  0x05: [0, 40],
  0x06: [10, 50],
  0x07: [20, 60],
  0x08: [30, 70],
  0x09: [40, 80],
  0x0a: [50, 90],
  0x0b: [60, 100],
  0x10: [-60, 20],
  0x11: [-50, 30],
  0x12: [-40, 40],
  0x13: [-30, 50],
  0x14: [-20, 60],
  0x15: [-10, 70],
  0x16: [0, 80],
  0x17: [10, 90],
  0x18: [20, 100],
  0x19: [30, 110],
  0x1a: [40, 120],
  0x1b: [50, 130],
  0x20: [-10, 41.2],
  0x30: [-40, 62.3],
};

function temperatureProfile(type, [min, max]) {
  const tenBits = type === 0x20 || type === 0x30;
  return {
    eep: `A5-02-${hex(type)}`,
    label: `Temperature sensor (${min} to ${max} °C)`,
    role: 'sensor',
    features: () => [temperature(min, max)],
    decode(telegram) {
      if (!is4bsData(telegram)) {
        return null;
      }
      const [, db2, db1] = telegram.payload;
      const value = tenBits
        ? scale(((db2 & 0x03) << 8) | db1, 1023, 0, min, max)
        : scale(db1, 255, 0, min, max);
      return { states: { temperature: round(value) } };
    },
  };
}

// ------------------------------------------------- A5-04: temp. + humidity --

function humidityProfile(type, [min, max]) {
  return {
    eep: `A5-04-${hex(type)}`,
    label: `Temperature and humidity sensor (${min} to ${max} °C)`,
    role: 'sensor',
    features: () => [temperature(min, max), humidity()],
    decode(telegram) {
      if (!is4bsData(telegram)) {
        return null;
      }
      const [, db2, db1, db0] = telegram.payload;
      const states = { humidity: round(scale(db2, 0, 250, 0, 100)) };
      // DB0.1: the temperature sensor is fitted.
      if (db0 & 0x02) {
        states.temperature = round(scale(db1, 0, 250, min, max));
      }
      return { states };
    },
  };
}

// --------------------------------------------------------- A5-06: light ----

const A5_06_01 = {
  eep: 'A5-06-01',
  label: 'Light sensor (300 to 60000 lx)',
  role: 'sensor',
  features: () => [illuminance(60000)],
  decode(telegram) {
    if (!is4bsData(telegram)) {
      return null;
    }
    const [, db2, db1, db0] = telegram.payload;
    // DB0.0 picks the range: 0 reads DB1 (600..60000 lx), 1 reads DB2 (300..30000 lx).
    const value = db0 & 0x01 ? scale(db2, 0, 255, 300, 30000) : scale(db1, 0, 255, 600, 60000);
    return { states: { illuminance: Math.round(value) } };
  },
};

const A5_06_02 = {
  eep: 'A5-06-02',
  label: 'Light sensor (0 to 1020 lx)',
  role: 'sensor',
  features: () => [illuminance(1020)],
  decode(telegram) {
    if (!is4bsData(telegram)) {
      return null;
    }
    const [, db2, db1, db0] = telegram.payload;
    const value = db0 & 0x01 ? scale(db2, 0, 255, 0, 510) : scale(db1, 0, 255, 0, 1020);
    return { states: { illuminance: Math.round(value) } };
  },
};

// ----------------------------------------------------- A5-07: occupancy ----

const A5_07_01 = {
  eep: 'A5-07-01',
  label: 'Occupancy sensor',
  role: 'sensor',
  features: () => [motion()],
  decode(telegram) {
    if (!is4bsData(telegram)) {
      return null;
    }
    // DB1: 0..127 nothing, 128..255 motion.
    return { states: { motion: telegram.payload[2] >= 128 ? 1 : 0 } };
  },
};

const A5_07_02 = {
  eep: 'A5-07-02',
  label: 'Occupancy sensor',
  role: 'sensor',
  features: () => [motion()],
  decode(telegram) {
    if (!is4bsData(telegram)) {
      return null;
    }
    return { states: { motion: telegram.payload[3] & 0x80 ? 1 : 0 } };
  },
};

const A5_07_03 = {
  eep: 'A5-07-03',
  label: 'Occupancy and light sensor',
  role: 'sensor',
  features: () => [motion(), illuminance(1000)],
  decode(telegram) {
    if (!is4bsData(telegram)) {
      return null;
    }
    const [, db2, db1, db0] = telegram.payload;
    const lux = (db2 << 2) | (db1 >> 6);
    const states = { motion: db0 & 0x80 ? 1 : 0 };
    // 1001..1023 are reserved values, not a reading.
    if (lux <= 1000) {
      states.illuminance = lux;
    }
    return { states };
  },
};

// --------------------------------------------------------- A5-09-04: CO2 ---

const A5_09_04 = {
  eep: 'A5-09-04',
  label: 'CO2, temperature and humidity sensor',
  role: 'sensor',
  features: () => [
    feature('co2', 'CO2', CATEGORIES.CO2_SENSOR, TYPES.SENSOR.INTEGER, {
      unit: UNITS.PPM,
      min: 0,
      max: 2550,
    }),
    temperature(0, 51),
    humidity(),
  ],
  decode(telegram) {
    if (!is4bsData(telegram)) {
      return null;
    }
    const [db3, db2, db1, db0] = telegram.payload;
    const states = { co2: db2 * 10 };
    if (db0 & 0x04) {
      states.humidity = round(db3 / 2);
    }
    if (db0 & 0x02) {
      states.temperature = round(scale(db1, 0, 255, 0, 51));
    }
    return { states };
  },
};

// ------------------------------------------------------- D5-00-01: contact -

const D5_00_01 = {
  eep: 'D5-00-01',
  label: 'Door or window contact',
  role: 'sensor',
  features: () => [opening()],
  decode(telegram) {
    // LRN bit (DB0.3) at 0 is a teach-in, not a state.
    if (telegram.rorg !== RORG.BS1 || (telegram.payload[0] & 0x08) === 0) {
      return null;
    }
    // DB0.0: 1 closed, 0 open — Gladys' opening sensor reads 1 as closed too.
    return { states: { contact: telegram.payload[0] & 0x01 } };
  },
};

// ---------------------------------------------------- F6-10-00: handle -----

/** @returns {'closed' | 'open' | 'tilted' | null} */
export function handlePosition(byte) {
  switch (byte & 0xf0) {
    case 0xf0:
      return 'closed';
    case 0xd0:
      return 'tilted';
    case 0xc0:
    case 0xe0:
      return 'open';
    default:
      return null;
  }
}

const F6_10_00 = {
  eep: 'F6-10-00',
  label: 'Window handle',
  role: 'sensor',
  features: () => [opening('Window')],
  decode(telegram) {
    if (telegram.rorg !== RORG.RPS) {
      return null;
    }
    const position = handlePosition(telegram.payload[0]);
    if (!position) {
      return null;
    }
    return { states: { contact: position === 'closed' ? 1 : 0 }, handle: position };
  },
};

// ------------------------------------------------- F6-02: rocker switch ----

/**
 * Read a rocker telegram (F6-02).
 *
 * Status bit NU (0x10) says how to read the data byte: at 1, R1 (bits 7-5) is
 * the button and EB (bit 4) pressed/released; at 0, bits 7-5 count the buttons
 * pressed together — and data 0x00 is the release of whatever was pressed.
 *
 * @returns {null | { pressed: boolean, buttons: string[] }}
 */
export function readRocker(telegram) {
  if (telegram.rorg !== RORG.RPS) {
    return null;
  }
  const data = telegram.payload[0];
  const pressed = (data & 0x10) !== 0;
  if ((telegram.status & 0x10) === 0) {
    // NU = 0: no button identified, or several at once.
    return { pressed, buttons: [] };
  }
  const buttons = [ROCKER_BUTTONS[data >> 5]];
  // SA (bit 0): a second button pressed together, in R2 (bits 3-1).
  if (data & 0x01) {
    buttons.push(ROCKER_BUTTONS[(data >> 1) & 0x07]);
  }
  return { pressed, buttons: buttons.filter(Boolean) };
}

function rockerListener(eep) {
  return {
    eep,
    label: 'Rocker switch (2 rockers)',
    role: 'sensor',
    features: () =>
      ROCKER_BUTTONS.map((button) =>
        feature(button, ROCKER_LABELS[button], CATEGORIES.BUTTON, TYPES.BUTTON.CLICK, {
          min: 0,
          max: 5,
          keep_history: false,
        }),
      ),
    decode(telegram) {
      const rocker = readRocker(telegram);
      return rocker ? { states: {}, rocker } : null;
    },
  };
}

// ------------------------------------------------------------ actuators ----

/** The upper (O) and lower (I) buttons of a rocker side. */
const rockerCode = (side, up) => ROCKER_BUTTONS.indexOf(`${side}${up ? 'o' : 'i'}`);

/**
 * The two telegrams of a rocker press: press, then release.
 * @param {number} code 0..3, see ROCKER_BUTTONS
 */
export function rockerPress(code) {
  return [
    // T21 + NU: one identified button, pressed.
    { rorg: RORG.RPS, payload: [(code << 5) | 0x10], status: 0x30 },
    // T21 only, data 0: released.
    { rorg: RORG.RPS, payload: [0x00], status: 0x20, delayMs: 100 },
  ];
}

const onOff = (hasFeedback) =>
  feature('switch', 'On/Off', CATEGORIES.SWITCH, TYPES.SWITCH.BINARY, {
    read_only: false,
    has_feedback: hasFeedback,
  });

const lightFeatures = (hasFeedback) => [
  feature('switch', 'On/Off', CATEGORIES.LIGHT, TYPES.LIGHT.BINARY, {
    read_only: false,
    has_feedback: hasFeedback,
  }),
  feature('brightness', 'Brightness', CATEGORIES.LIGHT, TYPES.LIGHT.BRIGHTNESS, {
    read_only: false,
    has_feedback: hasFeedback,
    unit: UNITS.PERCENT,
    min: 0,
    max: 100,
  }),
];

/** Feedback of an Eltako-style actuator: its own rocker telegram, top = on. */
function rockerFeedback(telegram) {
  const rocker = readRocker(telegram);
  if (!rocker || !rocker.pressed || rocker.buttons.length !== 1) {
    return null;
  }
  return { states: { switch: rocker.buttons[0].endsWith('o') ? 1 : 0 } };
}

// A relay that learned a rocker (Eltako FSR, FSB...): Gladys presses the
// upper side for on, the lower side for off, from its own channel.
const F6_02_01_ACTUATOR = {
  eep: 'F6-02-01',
  label: 'Relay paired with a virtual rocker',
  role: 'actuator',
  features: (device) => [onOff(Boolean(device.id))],
  decode: (telegram) => rockerFeedback(telegram),
  command(key, value, device) {
    if (key !== 'switch') {
      return null;
    }
    return rockerPress(rockerCode(device.rocker, value === 1));
  },
  teachIn: (device) => rockerPress(rockerCode(device.rocker, true)),
};

// A5-38-08 central command (Eltako FSR14, FUD14, FSG...): command 1 switches,
// command 2 dims. DB0.3 at 1 marks a data telegram, DB0.0 is on/off.
const A5_38_08 = {
  eep: 'A5-38-08',
  label: 'Switch or dimmer, central command',
  role: 'actuator',
  features: (device) =>
    device.dimmable ? lightFeatures(Boolean(device.id)) : [onOff(Boolean(device.id))],
  decode(telegram, device) {
    if (telegram.rorg === RORG.RPS) {
      return rockerFeedback(telegram);
    }
    if (!is4bsData(telegram)) {
      return null;
    }
    const [db3, db2, , db0] = telegram.payload;
    const on = db0 & 0x01;
    if (db3 === 0x02 && device.dimmable) {
      return { states: { switch: on, brightness: db2 } };
    }
    return { states: { switch: on } };
  },
  command(key, value, device) {
    if (key === 'brightness' && device.dimmable) {
      const level = Math.max(0, Math.min(100, Math.round(value)));
      return [{ rorg: RORG.BS4, payload: [0x02, level, 0x00, 0x08 | (level > 0 ? 1 : 0)] }];
    }
    if (key !== 'switch') {
      return null;
    }
    if (device.dimmable) {
      // Back on at the dimmer's own memory: dim value 0 means "keep it".
      return [{ rorg: RORG.BS4, payload: [0x02, 0x00, 0x00, 0x08 | (value === 1 ? 1 : 0)] }];
    }
    return [{ rorg: RORG.BS4, payload: [0x01, 0x00, 0x00, 0x08 | (value === 1 ? 1 : 0)] }];
  },
  // FUNC 0x38, TYPE 0x08, manufacturer 0x00D (Eltako), LRN type set.
  teachIn: () => [{ rorg: RORG.BS4, payload: [0xe0, 0x40, 0x0d, 0x80] }],
};

// D2-01 electronic switches and dimmers (NodOn, Permundo, Afriso...). They
// are addressed: every command goes to the device id, from the channel it
// was paired with (UTE teach-in, see runtime.js).
function d201Profile(type) {
  return {
    eep: `D2-01-${hex(type)}`,
    label: 'Electronic switch or dimmer',
    role: 'actuator',
    addressed: true,
    features: (device) => (device.dimmable ? lightFeatures(true) : [onOff(true)]),
    decode(telegram, device) {
      if (telegram.rorg !== RORG.VLD || telegram.payload.length < 3) {
        return null;
      }
      const [db2, db1, db0] = telegram.payload;
      // CMD 0x4: actuator status response.
      if ((db2 & 0x0f) !== 0x04) {
        return null;
      }
      const io = db1 & 0x1f;
      if (io !== device.io && io !== 0x1e) {
        return null;
      }
      const level = db0 & 0x7f;
      if (level > 100) {
        return null; // 0x7F: output value not valid or not set
      }
      return device.dimmable
        ? { states: { switch: level > 0 ? 1 : 0, ...(level > 0 && { brightness: level }) } }
        : { states: { switch: level > 0 ? 1 : 0 } };
    },
    command(key, value, device) {
      let level;
      if (key === 'switch') {
        level = value === 1 ? 100 : 0;
      } else if (key === 'brightness' && device.dimmable) {
        level = Math.max(0, Math.min(100, Math.round(value)));
      } else {
        return null;
      }
      // CMD 0x1: actuator set output, dim at once (DB1 bits 7-5 at 0).
      return [{ rorg: RORG.VLD, payload: [0x01, device.io & 0x1f, level] }];
    },
    // A D2-01 pairs by sending its own UTE query: nothing to send first.
    teachIn: () => null,
    // CMD 0x3: actuator status query.
    query: (device) => [{ rorg: RORG.VLD, payload: [0x03, device.io & 0x1f] }],
  };
}

// --------------------------------------------------------------- registry --

function hex(n) {
  return n.toString(16).toUpperCase().padStart(2, '0');
}

const SENSORS = [
  ...Object.entries(A5_02_RANGES).map(([type, range]) => temperatureProfile(Number(type), range)),
  humidityProfile(0x01, [0, 40]),
  humidityProfile(0x02, [-20, 60]),
  A5_06_01,
  A5_06_02,
  A5_07_01,
  A5_07_02,
  A5_07_03,
  A5_09_04,
  D5_00_01,
  F6_10_00,
  rockerListener('F6-02-01'),
  rockerListener('F6-02-02'),
];

const ACTUATORS = [
  F6_02_01_ACTUATOR,
  A5_38_08,
  ...Array.from({ length: 0x15 }, (_, type) => d201Profile(type)),
];

const SENSOR_BY_EEP = new Map(SENSORS.map((profile) => [profile.eep, profile]));
const ACTUATOR_BY_EEP = new Map(ACTUATORS.map((profile) => [profile.eep, profile]));

/** Every EEP code this integration reads or drives. */
export const SUPPORTED_EEPS = [...new Set([...SENSOR_BY_EEP.keys(), ...ACTUATOR_BY_EEP.keys()])];

/**
 * The profile of a declared device. F6-02-01 is both a rocker Gladys listens
 * to (an `id`, no `channel`) and a virtual rocker Gladys presses (a
 * `channel`): the channel decides.
 * @param {string} eep
 * @param {{ channel?: number | null }} [device]
 */
export function findProfile(eep, device = {}) {
  const actuator = ACTUATOR_BY_EEP.get(eep);
  const sensor = SENSOR_BY_EEP.get(eep);
  if (actuator && sensor) {
    return device.channel !== null && device.channel !== undefined ? actuator : sensor;
  }
  return actuator ?? sensor ?? null;
}

/**
 * The profile a teach-in or a plain telegram most likely means, for the
 * "Devices heard" suggestion. RPS and 1BS carry no profile: the common one
 * is guessed.
 */
export function guessEep(telegram, teachIn) {
  if (teachIn?.eep && findProfile(teachIn.eep)) {
    return teachIn.eep;
  }
  if (telegram.rorg === RORG.RPS) {
    return handlePosition(telegram.payload[0]) && (telegram.status & 0x10) === 0
      ? 'F6-10-00'
      : 'F6-02-01';
  }
  if (telegram.rorg === RORG.BS1) {
    return 'D5-00-01';
  }
  return teachIn?.eep ?? null;
}
