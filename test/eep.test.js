import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUTTON_STATUS,
  SUPPORTED_EEPS,
  findProfile,
  guessEep,
  handlePosition,
  readRocker,
} from '../src/enocean/eep.js';
import { RORG } from '../src/enocean/telegram.js';
import { telegram } from './helpers/fakes.js';

const sensor = (eep) => findProfile(eep, { channel: null });
const fourBs = (bytes) => telegram({ rorg: RORG.BS4, payload: bytes, senderId: '0194E3B2' });

test('A5-02-05 reads 0 to 40 °C, inverted', () => {
  const profile = sensor('A5-02-05');
  assert.deepEqual(profile.decode(fourBs([0, 0, 255, 0x08])).states, { temperature: 0 });
  assert.deepEqual(profile.decode(fourBs([0, 0, 0, 0x08])).states, { temperature: 40 });
  assert.deepEqual(profile.decode(fourBs([0, 0, 128, 0x08])).states, { temperature: 19.9 });
  // A teach-in telegram is not a reading.
  assert.equal(profile.decode(fourBs([0x08, 0x28, 0x0d, 0x80])), null);
});

test('A5-02-20 reads 10 bits', () => {
  const profile = sensor('A5-02-20');
  assert.deepEqual(profile.decode(fourBs([0, 0x03, 0xff, 0x08])).states, { temperature: -10 });
  assert.deepEqual(profile.decode(fourBs([0, 0, 0, 0x08])).states, { temperature: 41.2 });
});

test('A5-04-01 reads humidity, and temperature only when fitted', () => {
  const profile = sensor('A5-04-01');
  assert.deepEqual(profile.decode(fourBs([0, 125, 125, 0x0a])).states, {
    humidity: 50,
    temperature: 20,
  });
  assert.deepEqual(profile.decode(fourBs([0, 250, 125, 0x08])).states, { humidity: 100 });
});

test('A5-07-01 and A5-07-03 read motion', () => {
  assert.deepEqual(sensor('A5-07-01').decode(fourBs([0, 0, 200, 0x08])).states, { motion: 1 });
  assert.deepEqual(sensor('A5-07-01').decode(fourBs([0, 0, 10, 0x08])).states, { motion: 0 });
  assert.deepEqual(sensor('A5-07-03').decode(fourBs([0, 0x19, 0x00, 0x88])).states, {
    motion: 1,
    illuminance: 100,
  });
});

test('A5-09-04 reads CO2, humidity and temperature', () => {
  assert.deepEqual(sensor('A5-09-04').decode(fourBs([100, 80, 255, 0x0e])).states, {
    co2: 800,
    humidity: 50,
    temperature: 51,
  });
});

test('D5-00-01 reads 1 as closed, like Gladys', () => {
  const profile = sensor('D5-00-01');
  const contact = (byte) => telegram({ rorg: RORG.BS1, payload: [byte], senderId: '0194E3B2' });
  assert.deepEqual(profile.decode(contact(0x09)).states, { contact: 1 });
  assert.deepEqual(profile.decode(contact(0x08)).states, { contact: 0 });
  assert.equal(profile.decode(contact(0x00)), null); // teach-in
});

test('F6-10-00 reads the three handle positions', () => {
  assert.equal(handlePosition(0xf0), 'closed');
  assert.equal(handlePosition(0xc0), 'open');
  assert.equal(handlePosition(0xe0), 'open');
  assert.equal(handlePosition(0xd0), 'tilted');
  const profile = sensor('F6-10-00');
  const decoded = profile.decode(
    telegram({ rorg: RORG.RPS, payload: [0xd0], status: 0x20, senderId: '0194E3B2' }),
  );
  assert.deepEqual(decoded, { states: { contact: 0 }, handle: 'tilted' });
});

test('rocker telegrams name their buttons', () => {
  const rps = (data, status) =>
    telegram({ rorg: RORG.RPS, payload: [data], status, senderId: 'X' });
  assert.deepEqual(readRocker(rps(0x30, 0x30)), { pressed: true, buttons: ['ao'] });
  assert.deepEqual(readRocker(rps(0x10, 0x30)), { pressed: true, buttons: ['ai'] });
  assert.deepEqual(readRocker(rps(0x70, 0x30)), { pressed: true, buttons: ['bo'] });
  assert.deepEqual(readRocker(rps(0x00, 0x20)), { pressed: false, buttons: [] });
  // A and B upper together: R1 = AO, SA set, R2 = BO.
  assert.deepEqual(readRocker(rps(0x37, 0x30)), { pressed: true, buttons: ['ao', 'bo'] });
});

test('F6-02-01 is a rocker to listen to without a channel, a relay to drive with one', () => {
  assert.equal(findProfile('F6-02-01', { channel: null }).role, 'sensor');
  assert.equal(findProfile('F6-02-01', { channel: 3 }).role, 'actuator');
});

test('a virtual rocker relay presses the upper side for on', () => {
  const profile = findProfile('F6-02-01', { channel: 1 });
  const device = { channel: 1, rocker: 'a', id: null };
  const [press, release] = profile.command('switch', 1, device);
  assert.deepEqual(press.payload, [0x30]);
  assert.equal(press.status, 0x30);
  assert.deepEqual(release.payload, [0x00]);
  assert.deepEqual(profile.command('switch', 0, { ...device, rocker: 'b' })[0].payload, [0x50]);
  // Eltako confirmation telegrams: 0x70 on, 0x50 off.
  const feedback = (data) =>
    profile.decode(telegram({ rorg: RORG.RPS, payload: [data], status: 0x30, senderId: 'X' }));
  assert.deepEqual(feedback(0x70).states, { switch: 1 });
  assert.deepEqual(feedback(0x50).states, { switch: 0 });
});

test('A5-38-08 switches and dims with central commands', () => {
  const profile = findProfile('A5-38-08', { channel: 2 });
  assert.deepEqual(profile.command('switch', 1, { dimmable: false })[0].payload, [1, 0, 0, 0x09]);
  assert.deepEqual(profile.command('switch', 0, { dimmable: false })[0].payload, [1, 0, 0, 0x08]);
  assert.deepEqual(
    profile.command('brightness', 42, { dimmable: true })[0].payload,
    [2, 42, 0, 0x09],
  );
  assert.deepEqual(profile.teachIn()[0].payload, [0xe0, 0x40, 0x0d, 0x80]);
  assert.deepEqual(
    profile.features({ dimmable: true }).map((f) => f.key),
    ['switch', 'brightness'],
  );
});

test('D2-01 sets its output and reads its status', () => {
  const profile = findProfile('D2-01-12', { channel: 2 });
  const device = { id: '05123456', channel: 2, io: 1, dimmable: false };
  assert.equal(profile.addressed, true);
  assert.deepEqual(profile.command('switch', 1, device)[0].payload, [0x01, 0x01, 100]);
  const status = (bytes) =>
    profile.decode(telegram({ rorg: RORG.VLD, payload: bytes, senderId: '05123456' }), device);
  assert.deepEqual(status([0x04, 0x01, 0x64]).states, { switch: 1 });
  assert.deepEqual(status([0x04, 0x01, 0x00]).states, { switch: 0 });
  assert.equal(status([0x04, 0x00, 0x64]), null); // the other output
});

test('every feature carries the columns Gladys stores NOT NULL', () => {
  for (const eep of SUPPORTED_EEPS) {
    for (const channel of [null, 1]) {
      const profile = findProfile(eep, { channel });
      const device = { id: '0194E3B2', channel, io: 0, rocker: 'a', dimmable: true };
      for (const feature of profile.features(device)) {
        assert.ok(feature.name, `${eep}: name`);
        assert.equal(typeof feature.min, 'number', `${eep} ${feature.key}: min`);
        assert.equal(typeof feature.max, 'number', `${eep} ${feature.key}: max`);
        assert.equal(typeof feature.read_only, 'boolean', `${eep} ${feature.key}: read_only`);
        assert.equal(typeof feature.has_feedback, 'boolean', `${eep} ${feature.key}: feedback`);
      }
    }
  }
});

test('button clicks use the values of Gladys', () => {
  assert.deepEqual(BUTTON_STATUS, { CLICK: 1, LONG_CLICK: 3 });
});

test('a profile is guessed for telegrams that carry none', () => {
  const rps = telegram({ rorg: RORG.RPS, payload: [0x30], status: 0x30, senderId: 'X' });
  assert.equal(guessEep(rps, null), 'F6-02-01');
  const handle = telegram({ rorg: RORG.RPS, payload: [0xf0], status: 0x20, senderId: 'X' });
  assert.equal(guessEep(handle, null), 'F6-10-00');
  const contact = telegram({ rorg: RORG.BS1, payload: [0x09], senderId: 'X' });
  assert.equal(guessEep(contact, null), 'D5-00-01');
});
