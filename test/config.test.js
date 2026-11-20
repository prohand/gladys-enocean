import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseDevices } from '../src/config.js';

test('normalizeConfig forces the types a form may lose', () => {
  const config = normalizeConfig({ gateway_host: ' 192.168.1.50 ', gateway_port: '3333' });
  assert.equal(config.gateway_host, '192.168.1.50');
  assert.equal(config.gateway_port, 3333);
  assert.equal(config.unknown_devices_trigger, true);
  assert.equal(config.debug_logs, false);
  assert.equal(normalizeConfig({ gateway_port: 'abc' }).gateway_port, null);
  assert.equal(normalizeConfig().gateway_port, DEFAULT_CONFIG.gateway_port);
});

test('an empty device list is no error', () => {
  assert.deepEqual(parseDevices(''), { devices: [], errors: [] });
  assert.deepEqual(parseDevices('  '), { devices: [], errors: [] });
});

test('a list, a wrapped list, an object or one object per line are all read', () => {
  const entry = { id: '0194e3b2', eep: 'a5-02-05', name: 'Salon' };
  for (const text of [
    JSON.stringify([entry]),
    JSON.stringify({ devices: [entry] }),
    JSON.stringify(entry),
  ]) {
    const { devices, errors } = parseDevices(text);
    assert.deepEqual(errors, []);
    assert.equal(devices.length, 1);
    assert.equal(devices[0].id, '0194E3B2');
    assert.equal(devices[0].eep, 'A5-02-05');
    assert.equal(devices[0].key, '0194e3b2');
  }
  const lines = [
    '{"id":"0194E3B2","eep":"A5-02-05","name":"A"},',
    '{"id":"0194E3B3","eep":"D5-00-01","name":"B"}',
  ].join('\n');
  assert.equal(parseDevices(lines).devices.length, 2);
});

test('a wrong entry is reported and skipped, the others are kept', () => {
  const { devices, errors } = parseDevices(
    JSON.stringify([
      { id: '0194E3B2', eep: 'A5-02-05', name: 'Good' },
      { id: 'nope', eep: 'A5-02-05' },
      { id: '0194E3B4', eep: 'Z9-99-99' },
      { eep: 'A5-02-05', name: 'No id' },
      { eep: 'A5-38-08', name: 'No channel' },
      { eep: 'A5-38-08', channel: 200 },
      { id: '0194E3B2', eep: 'A5-04-01', name: 'Twice' },
      'text',
    ]),
  );
  assert.deepEqual(
    devices.map((d) => d.name),
    ['Good'],
  );
  assert.equal(errors.length, 7);
});

test('invalid JSON says so', () => {
  const { devices, errors } = parseDevices('[{"id": ');
  assert.equal(devices.length, 0);
  assert.match(errors[0], /not valid JSON/);
});

test('actuators are keyed on their channel, addressed ones on their id', () => {
  const { devices } = parseDevices(
    JSON.stringify([
      { eep: 'A5-38-08', channel: 3, name: 'Dimmer', dimmable: true },
      { eep: 'F6-02-01', channel: 4, rocker: 'B', name: 'Relay' },
      { id: '05123456', eep: 'D2-01-12', channel: 2, io: 1, name: 'Plug 2' },
      { id: '05123456', eep: 'D2-01-12', channel: 2, name: 'Plug 1' },
    ]),
  );
  assert.deepEqual(
    devices.map((d) => d.key),
    ['ch3', 'ch4', '05123456-io1', '05123456'],
  );
  assert.equal(devices[0].dimmable, true);
  assert.equal(devices[1].rocker, 'b');
  assert.equal(devices[1].profile.role, 'actuator');
});

test('an addressed actuator needs its id', () => {
  const { devices, errors } = parseDevices(JSON.stringify([{ eep: 'D2-01-12', channel: 2 }]));
  assert.equal(devices.length, 0);
  assert.match(errors[0], /needs its "id"/);
});
