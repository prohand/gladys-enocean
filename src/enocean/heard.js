// -----------------------------------------------------------------------------
// Emitters heard on the air, remembered in memory.
//
// Pairing an EnOcean sensor with Gladys means knowing its id and its profile.
// The id is printed on the device, but rarely legible; the profile sometimes
// travels in its teach-in telegram. So the integration remembers the last
// emitters it heard, and the "Devices heard" action and the widget turn them
// into the lines to paste in the device list.
// -----------------------------------------------------------------------------

import { guessEep } from './eep.js';
import { RORG_NAMES, teachInInfo } from './telegram.js';

export const MAX_HEARD = 50;

export class HeardList {
  #entries = new Map();
  #now;

  /** @param {() => number} [now] */
  constructor(now = Date.now) {
    this.#now = now;
  }

  /**
   * Remember a telegram. Returns the entry, with `isNew` when this sender was
   * not heard before.
   */
  record(telegram) {
    const teachIn = teachInInfo(telegram);
    const previous = this.#entries.get(telegram.senderId);
    const entry = {
      id: telegram.senderId,
      rorg: RORG_NAMES[telegram.rorg] ?? `0x${telegram.rorg.toString(16).toUpperCase()}`,
      // A teach-in names the profile for sure; keep it over later guesses.
      eep: teachIn?.eep ?? previous?.taughtEep ?? guessEep(telegram, teachIn),
      taughtEep: teachIn?.eep ?? previous?.taughtEep ?? null,
      manufacturer: teachIn?.manufacturer ?? previous?.manufacturer ?? null,
      teachIn: Boolean(teachIn) || Boolean(previous?.teachIn),
      dbm: telegram.dbm,
      count: (previous?.count ?? 0) + 1,
      firstAt: previous?.firstAt ?? this.#now(),
      lastAt: this.#now(),
    };
    // Re-insert: the Map keeps the most recent last.
    this.#entries.delete(telegram.senderId);
    this.#entries.set(telegram.senderId, entry);
    while (this.#entries.size > MAX_HEARD) {
      this.#entries.delete(this.#entries.keys().next().value);
    }
    return { ...entry, isNew: !previous };
  }

  get(id) {
    return this.#entries.get(id) ?? null;
  }

  /** Most recent first. */
  list() {
    return [...this.#entries.values()].reverse();
  }

  clear() {
    this.#entries.clear();
  }
}
