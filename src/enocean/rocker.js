// -----------------------------------------------------------------------------
// Rocker presses: from press/release telegrams to clicks.
//
// A PTM 215 module (the energy harvester of most EnOcean switches) sends one
// telegram on press and one on release, the release carrying no button. The
// duration between both makes a short or a long press. A release can be lost
// on the air: the press then counts as long after a few seconds, so a click is
// never swallowed.
// -----------------------------------------------------------------------------

export const LONG_PRESS_MS = 1000;
export const LOST_RELEASE_MS = 5000;

export class RockerTracker {
  #presses = new Map();
  #now;
  #onClick;

  /**
   * @param {(click: { key: string, buttons: string[], press: 'short' | 'long', durationMs: number | null }) => void} onClick
   * @param {() => number} [now]
   */
  constructor(onClick, now = Date.now) {
    this.#onClick = onClick;
    this.#now = now;
  }

  /**
   * @param {string} key the device the telegram belongs to
   * @param {{ pressed: boolean, buttons: string[] }} rocker see eep.readRocker
   */
  handle(key, rocker) {
    const current = this.#presses.get(key);
    if (rocker.pressed) {
      if (rocker.buttons.length === 0) {
        return; // several buttons, unidentified: nothing a scene can match
      }
      if (current && sameButtons(current.buttons, rocker.buttons)) {
        return; // the same press repeated by a repeater
      }
      if (current) {
        this.#finish(key, current, null);
      }
      const press = { buttons: rocker.buttons, at: this.#now() };
      press.timer = setTimeout(() => this.#finish(key, press, null), LOST_RELEASE_MS);
      press.timer.unref?.();
      this.#presses.set(key, press);
      return;
    }
    if (current) {
      this.#finish(key, current, this.#now() - current.at);
    }
  }

  #finish(key, press, durationMs) {
    if (this.#presses.get(key) !== press) {
      return;
    }
    clearTimeout(press.timer);
    this.#presses.delete(key);
    const long = durationMs === null || durationMs >= LONG_PRESS_MS;
    this.#onClick({ key, buttons: press.buttons, press: long ? 'long' : 'short', durationMs });
  }

  clear() {
    for (const press of this.#presses.values()) {
      clearTimeout(press.timer);
    }
    this.#presses.clear();
  }
}

function sameButtons(a, b) {
  return a.length === b.length && a.every((button, i) => button === b[i]);
}
