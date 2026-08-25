import { setDefaultOutput } from './logger.js';

// silence Logger output during tests (debug logging would pollute the test
// runner). tests that need to assert on output use the shared captureLogger()
// from src/test/helpers.js. set MARVIN_LOG_CONSOLE=1 to keep real console
// output while debugging.
if (!process.env.MARVIN_LOG_CONSOLE) {
  setDefaultOutput(() => {});
}
