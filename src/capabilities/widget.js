// -----------------------------------------------------------------------------
// The "EnOcean radio" dashboard widget (manifest `widgets`, Gladys 5.1+).
//
// What no device feature carries: is the gateway connected, which module is
// it, is the learn mode open, and what was heard last — the declared devices
// by name, the others by id, so a new sensor shows up the moment it talks.
// -----------------------------------------------------------------------------

import { createLogger, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { ago } from '../actions.js';
import { localize, pick } from '../i18n.js';

const logger = createLogger({ name: 'widget' });

/** Widget key, as declared in the manifest. Forever. */
export const RADIO_WIDGET = 'radio';

/** Keys of the buttons of the content. */
export const RADIO_ACTIONS = { LEARN: 'learn' };

export const DEFAULT_TELEGRAMS_SHOWN = 5;
const LEARN_SECONDS = 60;

function gatewayStatus(runtime) {
  const { gateway, config } = runtime;
  if (!config?.gateway_host) {
    return {
      value: {
        en: 'Not configured',
        fr: 'Non configurée',
        de: 'Nicht eingerichtet',
        es: 'Sin configurar',
      },
      color: WIDGET_COLORS.WARNING,
    };
  }
  if (gateway?.connected) {
    return {
      value: { en: 'Connected', fr: 'Connectée', de: 'Verbunden', es: 'Conectada' },
      color: WIDGET_COLORS.SUCCESS,
    };
  }
  return {
    value: { en: 'Unreachable', fr: 'Injoignable', de: 'Nicht erreichbar', es: 'Inaccesible' },
    color: WIDGET_COLORS.DANGER,
  };
}

function shownCount(settings) {
  const count = Number(settings?.telegrams ?? DEFAULT_TELEGRAMS_SHOWN);
  return Number.isInteger(count) ? Math.max(0, Math.min(8, count)) : DEFAULT_TELEGRAMS_SHOWN;
}

export function createWidgets(runtime, now = Date.now) {
  return {
    [RADIO_WIDGET]: {
      async get(_gladys, { settings }) {
        logger.debug(`onWidgetGet <- ${RADIO_WIDGET}`);
        const { gateway } = runtime;
        const items = [
          {
            label: { en: 'Gateway', fr: 'Passerelle', de: 'Gateway', es: 'Pasarela' },
            icon: 'radio',
            ...gatewayStatus(runtime),
          },
        ];
        if (gateway) {
          items.push({
            label: { en: 'Address', fr: 'Adresse', de: 'Adresse', es: 'Dirección' },
            icon: 'server',
            value: gateway.address.slice(0, 40),
            color: WIDGET_COLORS.NEUTRAL,
          });
        }
        if (gateway?.baseId) {
          items.push({
            label: { en: 'Base id', fr: 'Base id', de: 'Basis-ID', es: 'Base id' },
            icon: 'hash',
            value: gateway.baseId,
            color: WIDGET_COLORS.NEUTRAL,
          });
        }
        if (gateway?.version?.description) {
          items.push({
            label: { en: 'Module', fr: 'Module', de: 'Modul', es: 'Módulo' },
            icon: 'cpu',
            value: `${gateway.version.description} ${gateway.version.app}`.slice(0, 40),
            color: WIDGET_COLORS.NEUTRAL,
          });
        }
        items.push({
          label: { en: 'Devices', fr: 'Appareils', de: 'Geräte', es: 'Dispositivos' },
          icon: 'list',
          value: String(runtime.devices.length),
          color: runtime.configErrors.length ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
        });
        items.push(
          runtime.learning
            ? {
                label: {
                  en: 'Learn mode',
                  fr: 'Apprentissage',
                  de: 'Lernmodus',
                  es: 'Aprendizaje',
                },
                icon: 'link',
                value: localize(
                  (l) =>
                    `${Math.ceil((runtime.learnUntil - now()) / 1000)} s · ${runtime.learned.length} ${pick(l, { en: 'learned', fr: 'appris', de: 'gelernt', es: 'aprendidos' })}`,
                ),
                color: WIDGET_COLORS.INFO,
              }
            : {
                label: {
                  en: 'Learn mode',
                  fr: 'Apprentissage',
                  de: 'Lernmodus',
                  es: 'Aprendizaje',
                },
                icon: 'link',
                value: { en: 'Off', fr: 'Fermé', de: 'Aus', es: 'Cerrado' },
                color: WIDGET_COLORS.NEUTRAL,
              },
        );

        const components = [{ type: 'status', items }];

        const count = shownCount(settings);
        const heard = runtime.heard.list().slice(0, count);
        if (count > 0 && heard.length > 0) {
          const byId = new Map(runtime.devices.map((device) => [device.id, device]));
          components.push({
            type: 'card-list',
            display: 'list',
            items: heard.map((entry) => {
              const device = byId.get(entry.id);
              const parts = [device?.eep ?? entry.eep ?? entry.rorg];
              if (entry.dbm !== null) {
                parts.push(`${entry.dbm} dBm`);
              }
              return {
                title: (device?.name ?? entry.id).slice(0, 60),
                subtitle: localize((l) =>
                  [...parts, ago(now() - entry.lastAt, l)].join(' · ').slice(0, 60),
                ),
                ...(!device && {
                  badge: {
                    text: entry.teachIn
                      ? { en: 'Teach-in', fr: 'Appairage', de: 'Anlernen', es: 'Emparejar' }
                      : { en: 'Unknown', fr: 'Inconnu', de: 'Unbekannt', es: 'Desconocido' },
                    color: entry.teachIn ? WIDGET_COLORS.INFO : WIDGET_COLORS.WARNING,
                  },
                }),
              };
            }),
          });
        }

        components.push({
          type: 'button',
          label: {
            en: `Learn mode ${LEARN_SECONDS} s`,
            fr: `Apprentissage ${LEARN_SECONDS} s`,
            de: `Lernmodus ${LEARN_SECONDS} s`,
            es: `Aprendizaje ${LEARN_SECONDS} s`,
          },
          icon: 'link',
          style: 'secondary',
          action: { key: RADIO_ACTIONS.LEARN, params: { seconds: LEARN_SECONDS } },
        });

        return { ttl_seconds: 60, components };
      },

      async action(_gladys, { actionKey, params }) {
        logger.info(`onWidgetAction <- ${RADIO_WIDGET}.${actionKey}`);
        if (actionKey === RADIO_ACTIONS.LEARN) {
          const seconds = runtime.startLearnMode(Number(params?.seconds) || LEARN_SECONDS);
          return localize((l) =>
            pick(l, {
              en: `Learn mode open for ${seconds} s.`,
              fr: `Mode apprentissage ouvert pour ${seconds} s.`,
              de: `Lernmodus für ${seconds} s offen.`,
              es: `Modo de aprendizaje abierto durante ${seconds} s.`,
            }),
          );
        }
        throw new Error(`Unknown widget action: ${actionKey}`);
      },
    },
  };
}

/** Ask the core to re-pull the widgets now (rate-limited core-side). */
export function refreshWidgets(gladys) {
  try {
    gladys.requestWidgetRefresh(RADIO_WIDGET);
  } catch (err) {
    logger.debug(`Widget refresh not sent: ${err.message}`);
  }
}
