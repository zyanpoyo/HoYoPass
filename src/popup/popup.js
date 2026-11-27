import { createPopupController } from './popup-controller.js';
import { createChromePopupAdapter } from './popup-chrome-adapter.js';
import { mountPopupDom } from './popup-dom-adapter.js';

document.addEventListener('DOMContentLoaded', async () => {
  const controller = createPopupController(createChromePopupAdapter());
  const unmount = mountPopupDom(controller);
  window.addEventListener('pagehide', () => {
    unmount();
    controller.dispose();
  }, { once: true });
  await controller.init();
});
