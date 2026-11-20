import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { normalizeConfig } from '../src/config.js';
import { RORG } from '../src/enocean/telegram.js';
import { EnOceanRuntime, TRIGGERS } from '../src/runtime.js';
import { FakeGateway, telegram } from './helpers/fakes.js';

const DEVICES = [
  { id: '0194E3B2', eep: 'A5-02-05', name: 'Living room' },
  { id: 'FEF1A2B3', eep: 'F6-02-01', name: 'Entrance switch' },
  { id: '01A1B2C3', eep: 'F6-10-00', name: 'Kitchen window' },
  { eep: 'A5-38-08', channel: 3, name: 'Dimmer', dimmable: true },
  { id: '05123456', eep: 'D2-01-12', channel: 2, name: 'Plug' },
];

async function setup(devices = DEVICES, extra = {}) {
  const gladys = createFakeGladys();
  await gladys.connect();
  let gateway;
  let now = 1_000_000;
  const runtime = new EnOceanRuntime(gladys, {
    createGateway: (options) => (gateway = new FakeGateway(options)),
    now: () => now,
  });
  await runtime.applyConfig(
    normalizeConfig({ gateway_host: '192.168.1.50', devices: JSON.stringify(devices), ...extra }),
  );
  return {
    gladys,
    runtime,
    gateway,
    advance: (ms) => (now += ms),
    externalId: (key) => `ext:${gladys.fake.selector ?? 'test-integration'}:enocean:${key}`,
  };
}

test('the declared devices are published, with valid features', async () => {
  const { gladys, runtime } = await setup();
  assert.equal(gladys.fake.discoveredDevices.length, DEVICES.length);
  const names = gladys.fake.discoveredDevices.map((d) => d.name);
  assert.deepEqual(
    names,
    DEVICES.map((d) => d.name),
  );
  runtime.stop();
});

test('a sensor telegram becomes a Gladys state', async () => {
  const { gladys, runtime } = await setup();
  const [living] = gladys.fake.discoveredDevices;
  await runtime.handleTelegram(
    telegram({ rorg: RORG.BS4, payload: [0, 0, 0, 0x08], senderId: '0194E3B2' }),
  );
  assert.equal(gladys.fake.lastState(`${living.external_id}:temperature`), 40);
  runtime.stop();
});

test('a rocker press and release make one click and one scene event', async () => {
  const { gladys, runtime, advance } = await setup();
  const rocker = gladys.fake.discoveredDevices[1];
  const rps = (data, status) =>
    telegram({ rorg: RORG.RPS, payload: [data], status, senderId: 'FEF1A2B3' });
  await runtime.handleTelegram(rps(0x30, 0x30));
  await runtime.handleTelegram(rps(0x30, 0x30)); // repeated by a repeater: same press
  advance(200);
  await runtime.handleTelegram(rps(0x00, 0x20));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gladys.fake.lastState(`${rocker.external_id}:ao`), 1);
  const events = gladys.fake.sceneEvents.filter((e) => e.key === TRIGGERS.ROCKER_PRESSED);
  assert.equal(events.length, 1);
  assert.equal(events[0].data.button, 'ao');
  assert.equal(events[0].data.press, 'short');
  assert.equal(events[0].data.device, rocker.external_id);

  await runtime.handleTelegram(rps(0x50, 0x30));
  advance(1500);
  await runtime.handleTelegram(rps(0x00, 0x20));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gladys.fake.lastState(`${rocker.external_id}:bi`), 3);
  runtime.stop();
});

test('a window handle fires its trigger on a move only', async () => {
  const { gladys, runtime } = await setup();
  const handle = (data) =>
    telegram({ rorg: RORG.RPS, payload: [data], status: 0x20, senderId: '01A1B2C3' });
  await runtime.handleTelegram(handle(0xf0));
  await runtime.handleTelegram(handle(0xf0));
  await runtime.handleTelegram(handle(0xd0));
  const events = gladys.fake.sceneEvents.filter((e) => e.key === TRIGGERS.WINDOW_HANDLE_MOVED);
  assert.deepEqual(
    events.map((e) => e.data.position),
    ['closed', 'tilted'],
  );
  runtime.stop();
});

test('an unknown device fires its trigger once an hour, unless turned off', async () => {
  const { gladys, runtime, advance } = await setup();
  const unknown = telegram({ rorg: RORG.BS1, payload: [0x09], senderId: '0A0B0C0D' });
  await runtime.handleTelegram(unknown);
  await runtime.handleTelegram(unknown);
  advance(61 * 60 * 1000);
  await runtime.handleTelegram(unknown);
  const events = gladys.fake.sceneEvents.filter((e) => e.key === TRIGGERS.UNKNOWN_DEVICE_HEARD);
  assert.equal(events.length, 2);
  assert.equal(events[0].data.sender_id, '0A0B0C0D');
  assert.equal(events[0].data.eep, 'D5-00-01');
  runtime.stop();

  const off = await setup(DEVICES, { unknown_devices_trigger: false });
  await off.runtime.handleTelegram(unknown);
  assert.equal(off.gladys.fake.sceneEvents.length, 0);
  off.runtime.stop();
});

test('a Gladys order is sent from the device channel and shown at once', async () => {
  const { gladys, runtime, gateway } = await setup();
  const dimmer = gladys.fake.discoveredDevices[3];
  await runtime.setValue(dimmer.external_id, dimmer.features[1].external_id, 60);
  assert.deepEqual(gateway.sent, [{ rorg: RORG.BS4, payload: [2, 60, 0, 9], channel: 3 }]);
  assert.equal(gladys.fake.lastState(`${dimmer.external_id}:brightness`), 60);
  assert.equal(gladys.fake.lastState(`${dimmer.external_id}:switch`), 1);
  runtime.stop();
});

test('an addressed actuator is sent to its id', async (t) => {
  const { gladys, runtime, gateway } = await setup();
  t.after(() => runtime.stop());
  const plug = gladys.fake.discoveredDevices[4];
  await runtime.setValue(plug.external_id, plug.features[0].external_id, 1);
  assert.deepEqual(gateway.sent, [
    { rorg: RORG.VLD, payload: [1, 0, 100], channel: 2, destinationId: '05123456' },
  ]);
});

test('a refused order rejects, so Gladys shows the failure', async () => {
  const { gladys, runtime, gateway } = await setup();
  gateway.fail = new Error('the module answered ERROR');
  const dimmer = gladys.fake.discoveredDevices[3];
  await assert.rejects(
    runtime.setValue(dimmer.external_id, dimmer.features[0].external_id, 1),
    /answered ERROR/,
  );
  runtime.stop();
});

test('a UTE teach-in is answered during learn mode only', async () => {
  const { runtime, gateway } = await setup([]);
  const query = telegram({
    rorg: RORG.UTE,
    payload: [0xa0, 0x01, 0x46, 0x00, 0x12, 0x01, 0xd2],
    senderId: '05999999',
  });
  await runtime.handleTelegram(query);
  assert.equal(gateway.sent.length, 0);

  runtime.startLearnMode(30);
  await runtime.handleTelegram(query);
  assert.equal(gateway.sent.length, 1);
  assert.equal(gateway.sent[0].rorg, RORG.UTE);
  assert.equal(gateway.sent[0].destinationId, '05999999');
  assert.equal(gateway.sent[0].payload[0], 0x91);
  assert.deepEqual(runtime.learned, ['05999999']);
  assert.equal(runtime.heard.get('05999999').eep, 'D2-01-12');
  runtime.stop();
});

test('teach-in of an actuator sends its learn telegram', async () => {
  const { gladys, runtime, gateway } = await setup();
  const dimmer = gladys.fake.discoveredDevices[3];
  const result = await runtime.teachIn(dimmer.external_id);
  assert.equal(result.sent, true);
  assert.deepEqual(gateway.sent[0].payload, [0xe0, 0x40, 0x0d, 0x80]);
  const plug = gladys.fake.discoveredDevices[4];
  assert.equal((await runtime.teachIn(plug.external_id)).sent, false);
  runtime.stop();
});

test('the gateway state drives the badges, the status and the lost trigger', async () => {
  const { gladys, runtime, gateway } = await setup();
  gateway.setState('connected');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gladys.fake.connectionStatus.connected, true);
  const lastBadges = gladys.fake.transports.slice(-DEVICES.length);
  assert.ok(lastBadges.every((entry) => entry.transport === 'local'));
  // The D2-01 plug was asked for its state.
  assert.deepEqual(gateway.sent.at(-1).payload, [0x03, 0x00]);

  gateway.lastError = 'ECONNRESET';
  gateway.setState('disconnected');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gladys.fake.connectionStatus.connected, false);
  const lost = gladys.fake.sceneEvents.filter((e) => e.key === TRIGGERS.GATEWAY_DISCONNECTED);
  assert.equal(lost.length, 1);
  assert.equal(lost[0].data.reason, 'ECONNRESET');
  runtime.stop();
});

test('without a gateway address the status says what to do', async () => {
  const gladys = createFakeGladys();
  await gladys.connect();
  const runtime = new EnOceanRuntime(gladys, { createGateway: (o) => new FakeGateway(o) });
  await runtime.applyConfig(normalizeConfig({}));
  assert.equal(runtime.gateway, null);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  runtime.stop();
});
