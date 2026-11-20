import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createActions, ago } from '../src/actions.js';
import { createSceneActions } from '../src/capabilities/scenes.js';
import { normalizeConfig } from '../src/config.js';
import { RORG } from '../src/enocean/telegram.js';
import { LANGUAGES } from '../src/i18n.js';
import { EnOceanRuntime } from '../src/runtime.js';
import { FakeGateway, telegram } from './helpers/fakes.js';

async function setup(config) {
  const gladys = createFakeGladys();
  await gladys.connect();
  let gateway = null;
  const runtime = new EnOceanRuntime(gladys, {
    createGateway: (options) => (gateway = new FakeGateway(options)),
  });
  await runtime.applyConfig(normalizeConfig(config));
  return {
    gladys,
    runtime,
    gateway,
    actions: createActions(runtime),
    scenes: createSceneActions(runtime),
  };
}

const allLanguages = (message) =>
  LANGUAGES.forEach((language) => assert.ok(message[language], `missing ${language}`));

test('test_connection says what to fill in first', async () => {
  const { runtime, actions } = await setup({});
  const message = await actions.test_connection();
  allLanguages(message);
  assert.match(message.en, /No gateway address/);
  runtime.stop();
});

test('test_connection reports the gateway and the device list errors', async () => {
  const { runtime, gateway, actions } = await setup({
    gateway_host: '192.168.1.50',
    devices: JSON.stringify([{ id: 'bad', eep: 'A5-02-05' }]),
  });
  let message = await actions.test_connection();
  allLanguages(message);
  assert.match(message.en, /unreachable/);
  assert.match(message.en, /not an EnOcean id/);

  gateway.state = 'connected';
  message = await actions.test_connection();
  assert.match(message.en, /connected/);
  assert.match(message.fr, /Base id FF8A1C00/);
  assert.match(message.de, /GATEWAYCTRL/);
  runtime.stop();
});

test('list_heard writes the lines to paste for undeclared devices', async () => {
  const { runtime, actions } = await setup({
    gateway_host: '192.168.1.50',
    devices: JSON.stringify([{ id: '0194E3B2', eep: 'A5-02-05', name: 'Known' }]),
  });
  let message = await actions.list_heard();
  allLanguages(message);
  assert.match(message.en, /No undeclared device/);

  await runtime.handleTelegram(
    telegram({ rorg: RORG.BS4, payload: [0x08, 0x28, 0x0d, 0x80], senderId: '0A0B0C0D' }),
  );
  await runtime.handleTelegram(
    telegram({ rorg: RORG.BS4, payload: [0, 0, 0, 0x08], senderId: '0194E3B2' }),
  );
  message = await actions.list_heard();
  assert.match(message.en, /"id":"0A0B0C0D","eep":"A5-02-05"/);
  assert.match(message.fr, /profil envoyé par l'appareil/);
  assert.doesNotMatch(message.en, /0194E3B2/);
  runtime.stop();
});

test('learn_mode clamps its duration', async () => {
  const { runtime, actions } = await setup({ gateway_host: 'h' });
  const message = await actions.learn_mode({ seconds: 5000 });
  allLanguages(message);
  assert.match(message.en, /600 s/);
  runtime.stop();
});

test('teach_in reports a failure instead of throwing', async () => {
  const { gladys, runtime, gateway, actions } = await setup({
    gateway_host: 'h',
    devices: JSON.stringify([{ eep: 'A5-38-08', channel: 1, name: 'Relay' }]),
  });
  const [relay] = gladys.fake.discoveredDevices;
  let message = await actions.teach_in({ device: relay.external_id });
  assert.match(message.en, /sent from channel 1/);
  gateway.fail = new Error('the module answered ERROR');
  message = await actions.teach_in({ device: relay.external_id });
  assert.match(message.en, /not sent/);
  runtime.stop();
});

test('press_rocker sends a press and a release, and reports a failure as an output', async () => {
  const { runtime, gateway, scenes } = await setup({ gateway_host: 'h' });
  assert.deepEqual(await scenes.press_rocker({ channel: 4, button: 'bo' }), { sent: true });
  assert.deepEqual(
    gateway.sent.map((t) => [t.payload[0], t.channel]),
    [
      [0x70, 4],
      [0x00, 4],
    ],
  );
  await assert.rejects(scenes.press_rocker({ channel: 400, button: 'bo' }));
  await assert.rejects(scenes.press_rocker({ channel: 1, button: 'zz' }));
  gateway.fail = new Error('down');
  assert.deepEqual(await scenes.press_rocker({ channel: 4, button: 'bo' }), { sent: false });
  runtime.stop();
});

test('ago reads in every language', () => {
  assert.equal(ago(5000, 'fr'), 'il y a 5 s');
  assert.equal(ago(5 * 60000, 'de'), 'vor 5 Min.');
  assert.equal(ago(3 * 3600000, 'es'), 'hace 3 h');
});
