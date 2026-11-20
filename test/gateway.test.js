import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Gateway } from '../src/enocean/gateway.js';
import { RORG } from '../src/enocean/telegram.js';
import { FakeModuleSocket } from './helpers/fakes.js';

function connectedGateway() {
  const sockets = [];
  const gateway = new Gateway({
    host: '192.168.1.50',
    port: 9999,
    createConnection: () => {
      const socket = new FakeModuleSocket();
      sockets.push(socket);
      queueMicrotask(() => socket.emit('connect'));
      return socket;
    },
  });
  return { gateway, sockets };
}

test('the gateway reads the module version and base id once connected', async () => {
  const { gateway } = connectedGateway();
  gateway.start();
  await once(gateway, 'status'); // connecting is set synchronously, this is connected
  assert.equal(gateway.state, 'connected');
  assert.equal(gateway.baseId, 'FF8A1C00');
  assert.equal(gateway.version.description, 'GATEWAYCTRL');
  assert.equal(gateway.version.chipId, '0181A2B3');
  gateway.stop();
});

test('telegrams heard are emitted, decoded', async () => {
  const { gateway, sockets } = connectedGateway();
  gateway.start();
  await once(gateway, 'status');
  const heard = once(gateway, 'telegram');
  sockets[0].hear({ rorg: RORG.BS1, payload: [0x09], senderId: '0194E3B2', dbm: 0x4f });
  const [telegram] = await heard;
  assert.equal(telegram.senderId, '0194E3B2');
  assert.equal(telegram.dbm, -79);
  assert.equal(gateway.telegramCount, 1);
  gateway.stop();
});

test('a telegram is sent from base id + channel', async () => {
  const { gateway, sockets } = connectedGateway();
  gateway.start();
  await once(gateway, 'status');
  await gateway.sendTelegram({ rorg: RORG.BS4, payload: [1, 0, 0, 9] }, 5);
  const [sent] = sockets[0].sentTelegrams;
  assert.equal(sent.senderId, 'FF8A1C05');
  assert.deepEqual([...sent.payload], [1, 0, 0, 9]);
  gateway.stop();
});

test('a module that does not answer fails the request instead of hanging', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { gateway, sockets } = connectedGateway();
  gateway.start();
  await new Promise((resolve) => setImmediate(resolve));
  sockets[0].answer = false;
  const pending = gateway.readBaseId();
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(2000);
  await assert.rejects(pending, /no response/);
  gateway.stop();
});

test('without a base id nothing is sent', async () => {
  const gateway = new Gateway({
    host: 'h',
    port: 1,
    createConnection: () => new FakeModuleSocket(),
  });
  await assert.rejects(gateway.sendTelegram({ rorg: RORG.BS4, payload: [0] }, 0), /base id/);
});

test('a lost connection is reopened', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { gateway, sockets } = connectedGateway();
  gateway.start();
  await once(gateway, 'status');
  sockets[0].destroy();
  await once(gateway, 'status');
  assert.equal(gateway.state, 'disconnected');
  t.mock.timers.tick(1000);
  assert.equal(sockets.length, 2);
  gateway.stop();
});
