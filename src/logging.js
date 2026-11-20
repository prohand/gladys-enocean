// -----------------------------------------------------------------------------
// The log level, switchable from the Configuration screen.
//
// A sensor that never shows up in Gladys is either unheard, heard from an id
// nobody declared, or heard and not decoded: only the debug channel tells
// those apart. Reaching it used to mean setting `LOG_LEVEL=debug` on the
// container, i.e. a redeploy. The SDK logger re-reads `process.env.LOG_LEVEL`
// on every line, so writing that variable is enough: it takes effect at once,
// for every logger already created.
//
// The operator who already set `LOG_LEVEL` on the container keeps it: their
// value is the baseline, captured once at startup, and comes back when the
// switch goes off.
// -----------------------------------------------------------------------------

/** `LOG_LEVEL` as the container was started with, read once. */
const BASELINE = process.env.LOG_LEVEL;

/**
 * Apply the log level a configuration asks for.
 *
 * @param {{ debug_logs?: boolean }} config normalized configuration
 * @returns {string | undefined} the level in force afterwards
 */
export function applyLogLevel(config) {
  const wanted = config?.debug_logs ? 'debug' : BASELINE;
  if (wanted === undefined) {
    delete process.env.LOG_LEVEL;
  } else {
    process.env.LOG_LEVEL = wanted;
  }
  return wanted;
}
