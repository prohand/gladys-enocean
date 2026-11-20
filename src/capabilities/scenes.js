// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`, Gladys 5.1+).
//
// The scene TRIGGERS are fired by the runtime as things happen on the air
// (see TRIGGERS in src/runtime.js). Keys are stored by the scenes: forever.
//
// A scene action never throws for an expected outcome: it returns an output
// the scene author can gate on, and throws only when it could not run.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { ROCKER_BUTTONS } from '../enocean/eep.js';
import { MAX_CHANNEL } from '../config.js';

const logger = createLogger({ name: 'scenes' });

export function createSceneActions(runtime) {
  return {
    async press_rocker({ channel, button, long_press: longPress }) {
      const number = Number(channel);
      if (!Number.isInteger(number) || number < 0 || number > MAX_CHANNEL) {
        throw new Error(`Channel must be 0 to ${MAX_CHANNEL}`);
      }
      if (!ROCKER_BUTTONS.includes(button)) {
        throw new Error(`Unknown button "${button}"`);
      }
      logger.info(`Scene action press_rocker <- channel ${number}, ${button}`);
      try {
        await runtime.pressRocker(number, button, longPress === true);
        return { sent: true };
      } catch (err) {
        logger.warn(`press_rocker not sent: ${err.message}`);
        return { sent: false };
      }
    },

    async send_teach_in({ device }) {
      logger.info(`Scene action send_teach_in <- ${device}`);
      try {
        const { sent } = await runtime.teachIn(device);
        return { sent };
      } catch (err) {
        logger.warn(`send_teach_in not sent: ${err.message}`);
        return { sent: false };
      }
    },
  };
}
