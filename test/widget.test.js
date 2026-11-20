import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createWidgets, RADIO_ACTIONS, RADIO_WIDGET } from '../src/capabilities/widget.js';
import { normalizeConfig } from '../src/config.js';
import { RORG } from '../src/enocean/telegram.js';
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
  return { gladys, runtime, gateway, widget: createWidgets(runtime)[RADIO_WIDGET] };
}

test('the widget renders exactly as sent, before any configuration', async () => {
  const { gladys, runtime, widget } = await setup({});
  const content = await widget.get(gladys, { settings: {} });
  assert.deepEqual(validateWidgetContent(content), []);
  runtime.stop();
});

test('the widget lists the gateway, the learn mode and the devices heard', async () => {
  const { gladys, runtime, gateway, widget } = await setup({
    gateway_host: '192.168.1.50',
    devices: JSON.stringify([{ id: '0194E3B2', eep: 'A5-02-05', name: 'Living room' }]),
  });
  gateway.state = 'connected';
  runtime.startLearnMode(60);
  for (let i = 0; i < 10; i += 1) {
    await runtime.handleTelegram(
      telegram({
        rorg: RORG.BS1,
        payload: [0x09],
        senderId: `0A0B0C${String(i).padStart(2, '0')}`,
      }),
    );
  }
  await runtime.handleTelegram(
    telegram({ rorg: RORG.BS4, payload: [0, 0, 100, 0x08], senderId: '0194E3B2' }),
  );
  const content = await widget.get(gladys, { settings: { telegrams: 8 } });
  assert.deepEqual(validateWidgetContent(content), []);
  const list = content.components.find((c) => c.type === 'card-list');
  assert.equal(list.items.length, 8);
  assert.equal(list.items[0].title, 'Living room');
  assert.equal(list.items[1].badge.text.en, 'Unknown');

  const none = await widget.get(gladys, { settings: { telegrams: 0 } });
  assert.equal(
    none.components.some((c) => c.type === 'card-list'),
    false,
  );
  runtime.stop();
});

test('the learn button opens the learn mode', async () => {
  const { gladys, runtime, widget } = await setup({ gateway_host: '192.168.1.50' });
  const content = await widget.get(gladys, { settings: {} });
  const button = content.components.find((c) => c.type === 'button');
  const message = await widget.action(gladys, {
    actionKey: button.action.key,
    params: button.action.params,
  });
  assert.equal(button.action.key, RADIO_ACTIONS.LEARN);
  assert.equal(runtime.learning, true);
  assert.match(message.fr, /60 s/);
  await assert.rejects(widget.action(gladys, { actionKey: 'nope', params: {} }));
  runtime.stop();
});
