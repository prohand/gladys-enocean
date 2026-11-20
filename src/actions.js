// -----------------------------------------------------------------------------
// The buttons of the Configuration screen (manifest `actions`).
//
// Each handler resolves the multi-language message shown under the button.
// Keys are stored by Gladys: never rename them.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { localize, pick } from './i18n.js';

const logger = createLogger({ name: 'actions' });

const MAX_LISTED = 10;

/** How long ago, in words. */
export function ago(ms, language) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) {
    return pick(language, {
      en: `${seconds} s ago`,
      fr: `il y a ${seconds} s`,
      de: `vor ${seconds} s`,
      es: `hace ${seconds} s`,
    });
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) {
    return pick(language, {
      en: `${minutes} min ago`,
      fr: `il y a ${minutes} min`,
      de: `vor ${minutes} Min.`,
      es: `hace ${minutes} min`,
    });
  }
  const hours = Math.round(minutes / 60);
  return pick(language, {
    en: `${hours} h ago`,
    fr: `il y a ${hours} h`,
    de: `vor ${hours} Std.`,
    es: `hace ${hours} h`,
  });
}

/** The line to paste in the device list for an emitter heard. */
export function deviceLine(entry) {
  return JSON.stringify({
    id: entry.id,
    eep: entry.eep ?? 'A5-02-05',
    name: `EnOcean ${entry.id}`,
  });
}

export function createActions(runtime, now = Date.now) {
  return {
    async test_connection() {
      const { gateway, config, devices, configErrors } = runtime;
      if (!config?.gateway_host) {
        return localize((l) =>
          pick(l, {
            en: 'No gateway address: fill in the host and the port of your ser2net bridge, then save.',
            fr: "Aucune adresse de passerelle : renseignez l'hôte et le port de votre pont ser2net, puis enregistrez.",
            de: 'Keine Gateway-Adresse: Trage Host und Port deiner ser2net-Brücke ein und speichere.',
            es: 'Sin dirección de pasarela: indique el host y el puerto de su puente ser2net y guarde.',
          }),
        );
      }
      const lines = [];
      if (gateway?.connected) {
        const version = gateway.version;
        lines.push(
          localize((l) =>
            pick(l, {
              en: `Gateway ${gateway.address}: connected.`,
              fr: `Passerelle ${gateway.address} : connectée.`,
              de: `Gateway ${gateway.address}: verbunden.`,
              es: `Pasarela ${gateway.address}: conectada.`,
            }),
          ),
        );
        if (version) {
          lines.push(
            localize(
              (l) =>
                `${pick(l, { en: 'Module', fr: 'Module', de: 'Modul', es: 'Módulo' })}: ${version.description || '?'} ${version.app}, chip ${version.chipId}.`,
            ),
          );
        }
        lines.push(
          gateway.baseId
            ? localize((l) =>
                pick(l, {
                  en: `Base id ${gateway.baseId}: Gladys sends from ${gateway.baseId} + channel.`,
                  fr: `Base id ${gateway.baseId} : Gladys émet depuis ${gateway.baseId} + canal.`,
                  de: `Basis-ID ${gateway.baseId}: Gladys sendet von ${gateway.baseId} + Kanal.`,
                  es: `Base id ${gateway.baseId}: Gladys emite desde ${gateway.baseId} + canal.`,
                }),
              )
            : localize((l) =>
                pick(l, {
                  en: 'Base id unknown: the module did not answer, actuators cannot be driven.',
                  fr: "Base id inconnu : le module n'a pas répondu, les actionneurs ne peuvent pas être pilotés.",
                  de: 'Basis-ID unbekannt: Das Modul hat nicht geantwortet, Aktoren können nicht gesteuert werden.',
                  es: 'Base id desconocido: el módulo no respondió, no se pueden controlar los actuadores.',
                }),
              ),
        );
        lines.push(
          localize((l) =>
            pick(l, {
              en: `${gateway.telegramCount} telegram(s) heard since the connection.`,
              fr: `${gateway.telegramCount} télégramme(s) entendu(s) depuis la connexion.`,
              de: `${gateway.telegramCount} Telegramm(e) seit der Verbindung empfangen.`,
              es: `${gateway.telegramCount} telegrama(s) recibido(s) desde la conexión.`,
            }),
          ),
        );
      } else {
        const reason = gateway?.lastError ? ` (${gateway.lastError})` : '';
        lines.push(
          localize((l) =>
            pick(l, {
              en: `Gateway ${gateway?.address ?? config.gateway_host} unreachable${reason}. Check that ser2net runs and that the port is open from the Gladys host.`,
              fr: `Passerelle ${gateway?.address ?? config.gateway_host} injoignable${reason}. Vérifiez que ser2net tourne et que le port est ouvert depuis la machine Gladys.`,
              de: `Gateway ${gateway?.address ?? config.gateway_host} nicht erreichbar${reason}. Prüfe, ob ser2net läuft und der Port vom Gladys-Host aus offen ist.`,
              es: `Pasarela ${gateway?.address ?? config.gateway_host} inaccesible${reason}. Compruebe que ser2net funciona y que el puerto está abierto desde la máquina de Gladys.`,
            }),
          ),
        );
      }
      lines.push(
        localize((l) =>
          pick(l, {
            en: `${devices.length} device(s) declared.`,
            fr: `${devices.length} appareil(s) déclaré(s).`,
            de: `${devices.length} Gerät(e) angegeben.`,
            es: `${devices.length} dispositivo(s) declarado(s).`,
          }),
        ),
      );
      for (const error of configErrors) {
        lines.push(localize(() => error));
      }
      return localize((l) => lines.map((line) => line[l]).join('\n'));
    },

    async list_heard() {
      const declared = new Set(runtime.devices.map((device) => device.id));
      const heard = runtime.heard.list().filter((entry) => !declared.has(entry.id));
      if (heard.length === 0) {
        return localize((l) =>
          pick(l, {
            en: 'No undeclared device heard yet. Press the button of the device (or its learn button), then try again.',
            fr: "Aucun appareil non déclaré entendu pour l'instant. Appuyez sur le bouton de l'appareil (ou son bouton d'apprentissage), puis réessayez.",
            de: 'Noch kein nicht angegebenes Gerät empfangen. Drücke die Taste des Geräts (oder seine Lerntaste) und versuche es erneut.',
            es: 'Aún no se ha oído ningún dispositivo no declarado. Pulse el botón del dispositivo (o su botón de aprendizaje) y vuelva a intentarlo.',
          }),
        );
      }
      const listed = heard.slice(0, MAX_LISTED);
      return localize((l) => {
        const intro = pick(l, {
          en: 'Heard, not declared — add the lines to the Devices field, check the profile, rename:',
          fr: 'Entendus, non déclarés — ajoutez les lignes au champ Appareils, vérifiez le profil, renommez :',
          de: 'Empfangen, nicht angegeben — füge die Zeilen ins Feld Geräte ein, prüfe das Profil, benenne um:',
          es: 'Oídos, no declarados — añada las líneas al campo Dispositivos, compruebe el perfil y cambie el nombre:',
        });
        const rows = listed.map((entry) => {
          const sure = entry.taughtEep
            ? pick(l, {
                en: 'profile sent by the device',
                fr: "profil envoyé par l'appareil",
                de: 'Profil vom Gerät gesendet',
                es: 'perfil enviado por el dispositivo',
              })
            : pick(l, {
                en: 'profile guessed',
                fr: 'profil deviné',
                de: 'Profil geschätzt',
                es: 'perfil supuesto',
              });
          return `${deviceLine(entry)}\n  ↳ ${entry.rorg}, ${entry.dbm ?? '?'} dBm, ${ago(now() - entry.lastAt, l)}, ${sure}`;
        });
        return [intro, ...rows].join('\n');
      });
    },

    async learn_mode(fields = {}) {
      const seconds = runtime.startLearnMode(Number(fields.seconds) || 60);
      return localize((l) =>
        pick(l, {
          en: `Learn mode open for ${seconds} s: press the learn button of the device now. Then use "Devices heard".`,
          fr: `Mode apprentissage ouvert pour ${seconds} s : appuyez maintenant sur le bouton d'apprentissage de l'appareil. Utilisez ensuite « Appareils entendus ».`,
          de: `Lernmodus für ${seconds} s offen: Drücke jetzt die Lerntaste des Geräts. Nutze danach „Empfangene Geräte“.`,
          es: `Modo de aprendizaje abierto durante ${seconds} s: pulse ahora el botón de aprendizaje del dispositivo. Después use «Dispositivos oídos».`,
        }),
      );
    },

    async teach_in(fields = {}) {
      try {
        const { device, sent } = await runtime.teachIn(fields.device);
        if (!sent) {
          return localize((l) =>
            pick(l, {
              en: `${device.name} pairs from its own side: open the learn mode here, then press its button.`,
              fr: `${device.name} s'appaire de son côté : ouvrez le mode apprentissage ici, puis appuyez sur son bouton.`,
              de: `${device.name} koppelt sich von seiner Seite: Öffne hier den Lernmodus und drücke dann seine Taste.`,
              es: `${device.name} se empareja desde su lado: abra aquí el modo de aprendizaje y luego pulse su botón.`,
            }),
          );
        }
        return localize((l) =>
          pick(l, {
            en: `Teach-in telegram sent from channel ${device.channel} to ${device.name}. The actuator must be in learn mode.`,
            fr: `Télégramme d'apprentissage envoyé du canal ${device.channel} vers ${device.name}. L'actionneur doit être en mode apprentissage.`,
            de: `Lerntelegramm von Kanal ${device.channel} an ${device.name} gesendet. Der Aktor muss im Lernmodus sein.`,
            es: `Telegrama de aprendizaje enviado desde el canal ${device.channel} a ${device.name}. El actuador debe estar en modo de aprendizaje.`,
          }),
        );
      } catch (err) {
        logger.warn(`Teach-in failed: ${err.message}`);
        return localize((l) =>
          pick(l, {
            en: `Teach-in not sent: ${err.message}`,
            fr: `Apprentissage non envoyé : ${err.message}`,
            de: `Lerntelegramm nicht gesendet: ${err.message}`,
            es: `Aprendizaje no enviado: ${err.message}`,
          }),
        );
      }
    },
  };
}
