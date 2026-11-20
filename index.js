// -----------------------------------------------------------------------------
// Entry point of the EnOcean integration for Gladys Assistant.
//
// This file only wires the SDK to the runtime (src/runtime.js): handlers are
// registered BEFORE connect(), as the SDK requires. No radio logic here.
//
// Environment variables injected by the Gladys supervisor, read by the SDK:
//   GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createActions } from './src/actions.js';
import { createSceneActions } from './src/capabilities/scenes.js';
import { createWidgets, refreshWidgets } from './src/capabilities/widget.js';
import { normalizeConfig } from './src/config.js';
import { applyLogLevel } from './src/logging.js';
import { EnOceanRuntime } from './src/runtime.js';

const gladys = new GladysIntegration();
const runtime = new EnOceanRuntime(gladys, { onChange: () => refreshWidgets(gladys) });

async function configure(rawConfig) {
  const config = normalizeConfig(rawConfig);
  applyLogLevel(config);
  await runtime.applyConfig(config);
}

// --- Discovery ---------------------------------------------------------------
gladys.onScanRequest(async () => {
  await runtime.applyConfig(runtime.config ?? normalizeConfig());
});

// --- Orders from Gladys --------------------------------------------------------
gladys.onSetValue(async (device, feature, value) => {
  logger.info(`onSetValue <- ${feature.external_id} = ${value}`);
  await runtime.setValue(device.external_id, feature.external_id, value);
});

// --- Configuration screen buttons -----------------------------------------------
const actions = createActions(runtime);
gladys.onAction('test_connection', () => actions.test_connection());
gladys.onAction('list_heard', () => actions.list_heard());
gladys.onAction('learn_mode', (fields) => actions.learn_mode(fields));
gladys.onAction('teach_in', (fields) => actions.teach_in(fields));

// --- Scene actions (Gladys 5.1+) ------------------------------------------------
// The scene triggers need no handler: the runtime fires them with
// publishSceneEvent as telegrams arrive.
for (const [key, handler] of Object.entries(createSceneActions(runtime))) {
  gladys.onSceneAction(key, (fields) => handler(fields));
}

// --- Dashboard widget (Gladys 5.1+) -----------------------------------------------
for (const [key, widget] of Object.entries(createWidgets(runtime))) {
  gladys.onWidgetGet(key, (request) => widget.get(gladys, request));
  gladys.onWidgetAction(key, (actionKey, params, { settings }) =>
    widget.action(gladys, { actionKey, params, settings }),
  );
}

// --- Configuration saved by the user ------------------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  try {
    await configure(newConfig);
  } catch (err) {
    logger.error('Configuration could not be applied', err);
  }
});

// --- Connection lifecycle -------------------------------------------------------
gladys.on('connected', async () => {
  try {
    await configure(await gladys.getConfig());
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    await gladys
      .setConnectionStatus(false, {
        en: 'Initialization failed, check the integration logs.',
        fr: "L'initialisation a échoué, consultez les journaux de l'intégration.",
        de: 'Initialisierung fehlgeschlagen, prüfe die Protokolle der Integration.',
        es: 'La inicialización falló, consulte los registros de la integración.',
      })
      .catch(() => {});
  }
});

process.on('unhandledRejection', (err) => {
  logger.error('Unhandled promise rejection', err);
});

// --- Graceful shutdown ----------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> closing the gateway connection`);
  runtime.stop();
});

logger.info('Starting the EnOcean integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
