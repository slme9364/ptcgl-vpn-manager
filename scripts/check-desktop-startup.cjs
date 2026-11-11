const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'apps/desktop/out/main/index.js'), 'utf8');
assert.match(main, /preload\/index\.cjs/);
const preload = fs.readFileSync(path.join(root, 'apps/desktop/out/preload/index.cjs'), 'utf8');
let api;
const calls = [];
const listeners = new Map();
vm.runInNewContext(preload, {
  require(name) {
    assert.equal(name, 'electron');
    return {
      contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, 'ptcgl'); api = value; } },
      ipcRenderer: {
        invoke(channel, ...args) { calls.push([channel, ...args]); return Promise.resolve(); },
        on(channel, handler) { listeners.set(channel, handler); },
        removeListener(channel, handler) { assert.equal(listeners.get(channel), handler); listeners.delete(channel); }
      }
    };
  }
});
assert.ok(api);
api.getState(); api.getSettings(); api.getUpdateState();
assert.deepEqual(calls.map(([channel]) => channel), ['state:get', 'settings:get', 'update:get']);
let received;
const off = api.onState(value => { received = value; });
listeners.get('state:changed')({}, { vmStatus: 'UNKNOWN' });
assert.equal(received.vmStatus, 'UNKNOWN');
off(); assert.equal(listeners.size, 0);
console.log('PASS: built sandbox preload executes as CommonJS, exposes startup IPC, and removes listeners');
