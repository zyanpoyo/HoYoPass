import { createBackgroundRunner } from './background-runner.js';
import { createChromeBackgroundAdapter, bindChromeListeners } from './chrome-adapter.js';

const runner = createBackgroundRunner(createChromeBackgroundAdapter());
bindChromeListeners(runner, chrome);
