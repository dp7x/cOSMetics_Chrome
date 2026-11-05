// Visibility belongs to this page only; preferences remain in storage.
(() => {
  const state = { overtureEnabled: false, fixerEnabled: false, simplifyEnabled: false };
  const listeners = new Map();
  globalThis.CosmeticsPanels = Object.freeze({
    subscribe(key, callback) {
      if (!Object.hasOwn(state, key)) return;
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(callback);
      callback(state[key]);
    }
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.kind !== 'cosmetics-panels') return;
    if (message.action === 'set' && Object.hasOwn(state, message.key) && typeof message.value === 'boolean') {
      state[message.key] = message.value;
      for (const callback of listeners.get(message.key) || []) callback(message.value);
    }
    respond({ ...state });
  });
})();
