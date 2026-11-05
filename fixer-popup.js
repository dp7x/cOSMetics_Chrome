// Switches reflect the active iD tab, never persistent storage.
(() => {
  const inputs = ['overtureEnabled', 'fixerEnabled', 'simplifyEnabled'].map(id => document.getElementById(id));
  for (const input of inputs) { input.checked = false; input.disabled = true; }
  const ready = (async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab');
    const state = await chrome.tabs.sendMessage(tab.id, { kind: 'cosmetics-panels', action: 'get' });
    if (!state) throw new Error('No iD panel state');
    for (const input of inputs) { input.checked = state[input.id] === true; input.disabled = false; }
    return tab.id;
  })();
  for (const input of inputs) {
    input.addEventListener('change', async () => {
      const previous = !input.checked;
      input.disabled = true;
      try {
        const tabId = await ready;
        const state = await chrome.tabs.sendMessage(tabId, {
          kind: 'cosmetics-panels', action: 'set', key: input.id, value: input.checked
        });
        if (!state) throw new Error('iD unavailable');
        input.checked = state[input.id] === true;
      } catch { input.checked = previous; }
      finally { input.disabled = false; }
    });
  }
  ready.catch(() => { for (const input of inputs) { input.checked = false; input.disabled = true; } });
})();
