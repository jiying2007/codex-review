'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createRequire } = require('node:module');

test('constrained packaging authentication dependencies retain the CommonJS GUID API', () => {
  const fromVsce = createRequire(require.resolve('@vscode/vsce'));
  const fromIdentity = createRequire(fromVsce.resolve('@azure/identity'));
  const identity = fromVsce('@azure/identity');
  const { CryptoProvider } = fromIdentity('@azure/msal-node');
  assert.equal(typeof identity.ClientSecretCredential, 'function');
  const crypto = new CryptoProvider();
  const first = crypto.createNewGuid(), second = crypto.createNewGuid();
  assert.match(first, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i);
  assert.notEqual(first, second);
});
