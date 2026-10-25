'use strict';

// Identity 4.14.0 keeps the structured developer-credential process fixes.
// MSAL 7.1.0 is an intentional override of Identity's ^6 range for
// https://github.com/advisories/GHSA-xcx6-jx8p-x3h5.
// These regressions qualify the VSCE credential surfaces without live authentication.
const assert = require('node:assert/strict');
const { createRequire, syncBuiltinESMExports } = require('node:module');
const path = require('node:path');
const { test, beforeEach, after } = require('node:test');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const fromProject = createRequire(path.join(root, 'package.json'));
const fromVsce = createRequire(fromProject.resolve('@vscode/vsce'));
const identityEntry = fromVsce.resolve('@azure/identity');
const fromIdentity = createRequire(identityEntry);
const identityDir = path.dirname(identityEntry);
const guard = { network: 0, childProcess: 0 };
function denied(kind) {
  return function () {
    guard[kind]++;
    throw new Error('Forbidden real ' + kind + ' operation in synthetic compatibility assessment');
  };
}
for (const moduleName of ['node:http', 'node:https']) {
  const mod = require(moduleName);
  mod.request = denied('network');
  mod.get = denied('network');
}
require('node:net').connect = denied('network');
require('node:net').createConnection = denied('network');
require('node:tls').connect = denied('network');
globalThis.fetch = denied('network');
for (const key of ['exec', 'execFile', 'spawn', 'fork', 'execSync', 'execFileSync', 'spawnSync']) {
  require('node:child_process')[key] = denied('childProcess');
}
syncBuiltinESMExports();
resetEnvironment();
const identity = fromVsce('@azure/identity');
const msal = fromIdentity('@azure/msal-node');
const { IdentityClient } = require(path.join(identityDir, 'client/identityClient.js'));
const { processUtils } = require(path.join(identityDir, 'util/processUtils.js'));
const { createHttpHeaders } = fromIdentity('@azure/core-rest-pipeline');
const tenant = '11111111-1111-1111-1111-111111111111';
const client = '22222222-2222-2222-2222-222222222222';
const secret = 'synthetic-client-secret-no-real-credential';
const scope = '499b84ac-1321-427f-aa17-267ca6975798/.default';
const resource = scope.slice(0, -'/.default'.length);
const authority = 'https://login.microsoftonline.com/' + tenant;
const metadata = {
  authorization_endpoint: authority + '/oauth2/v2.0/authorize',
  token_endpoint: authority + '/oauth2/v2.0/token',
  issuer: authority + '/v2.0',
  jwks_uri: authority + '/discovery/v2.0/keys',
  end_session_endpoint: authority + '/oauth2/v2.0/logout',
  response_types_supported: ['code'],
  response_modes_supported: ['query', 'form_post'],
  scopes_supported: ['openid', 'profile', 'offline_access'],
  subject_types_supported: ['pairwise'],
  id_token_signing_alg_values_supported: ['RS256']
};
let transportCalls = [];
let processCalls = [];
let cliUnavailable = false;
function resetEnvironment() {
  for (const name of Object.keys(process.env)) {
    if (/^(AZURE_|MSI_|IDENTITY_|IMDS_|VSCE_|VSCODE_|ACTIONS_ID_TOKEN_)/i.test(name)) delete process.env[name];
  }
}
function responseFor(url, method, body) {
  const parsed = new URL(url);
  transportCalls.push({ host: parsed.host, path: parsed.pathname, method });
  assert.ok(['login.microsoftonline.com', 'managed-identity.invalid'].includes(parsed.hostname), 'unexpected network target: ' + parsed.hostname);
  if (parsed.hostname === 'managed-identity.invalid') {
    assert.equal(parsed.searchParams.get('resource'), resource);
    return { access_token: 'synthetic-managed-token', expires_on: String(Math.floor(Date.now() / 1000) + 3600), resource, token_type: 'Bearer', client_id: client };
  }
  if (parsed.pathname.includes('/discovery/instance')) {
    return { tenant_discovery_endpoint: authority + '/v2.0/.well-known/openid-configuration', metadata: [{ preferred_network: 'login.microsoftonline.com', preferred_cache: 'login.microsoftonline.com', aliases: ['login.microsoftonline.com'] }] };
  }
  if (parsed.pathname.includes('/.well-known/openid-configuration')) return metadata;
  assert.equal(parsed.pathname, '/' + tenant + '/oauth2/v2.0/token');
  assert.equal(method, 'POST');
  const params = new URLSearchParams(body);
  assert.equal(params.get('client_id'), client);
  assert.equal(params.get('client_secret'), secret);
  assert.ok(params.get('scope').split(' ').includes(scope));
  const grant = params.get('grant_type');
  assert.ok(['client_credentials', 'authorization_code'].includes(grant), 'unexpected grant ' + grant);
  if (grant === 'authorization_code') assert.equal(params.get('code'), 'synthetic-request-code');
  return { token_type: 'Bearer', access_token: 'synthetic-' + grant + '-token', expires_in: 3600, ext_expires_in: 3600, scope };
}
async function sendSynthetic(request) {
  const body = responseFor(request.url, request.method, request.body);
  return { request, status: 200, headers: createHttpHeaders({ 'content-type': 'application/json' }), bodyAsText: JSON.stringify(body) };
}
const realSendRequest = IdentityClient.prototype.sendRequest;
IdentityClient.prototype.sendRequest = sendSynthetic;
const realExecWithResult = processUtils.execFileWithResult;
processUtils.execFileWithResult = async (file, args, options) => {
  assert.equal(typeof file, 'string');
  assert.ok(Array.isArray(args));
  assert.notEqual(options?.shell, true);
  processCalls.push({
    file, args: [...args],
    allowWindowsBatchFiles: options?.allowWindowsBatchFiles ?? false,
    privateResource: options?.env?.AZURE_IDENTITY_POWERSHELL_RESOURCE,
    privateTenant: options?.env?.AZURE_IDENTITY_POWERSHELL_TENANT_ID
  });
  if (file === 'az') {
    if (cliUnavailable) return { stdout: '', stderr: 'az: not found', error: null };
    return { stdout: JSON.stringify({ accessToken: 'synthetic-az-token', expires_on: String(Math.floor(Date.now() / 1000) + 3600) }), stderr: '', error: null };
  }
  if (file === 'azd') return { stdout: JSON.stringify({ token: 'synthetic-azd-token', expiresOn: new Date(Date.now() + 3600000).toISOString() }), stderr: '', error: null };
  assert.ok(['pwsh', 'powershell', 'pwsh.exe', 'powershell.exe'].includes(file), 'unexpected executable');
  if (args[0] === '/?') return { stdout: 'synthetic help', stderr: '', error: null };
  return { stdout: JSON.stringify({ Token: 'synthetic-pwsh-token', ExpiresOn: new Date(Date.now() + 3600000).toISOString() }), stderr: '', error: null };
};
// The SDK and VSCE are real; only the HTTP/process transport boundaries are fixtures.
// This file runs in its own Node test process and clears credential environment keys
// before loading credentials. No user token, certificate, Keychain, or Azure CLI runs.
beforeEach(() => {
  resetEnvironment();
  transportCalls = [];
  processCalls = [];
  cliUnavailable = false;
});
after(() => {
  IdentityClient.prototype.sendRequest = realSendRequest;
  processUtils.execFileWithResult = realExecWithResult;
  resetEnvironment();
  assert.deepEqual(guard, { network: 0, childProcess: 0 });
});

test('CommonJS and ESM SDK load plus real CryptoProvider GUID API', async () => {
  const esm = await import(pathToFileURL(path.resolve(identityDir, '../esm/index.js')).href);
  assert.equal(typeof esm.ClientSecretCredential, 'function');
  const crypto = new msal.CryptoProvider();
  const first = crypto.createNewGuid(), second = crypto.createNewGuid();
  assert.match(first, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i);
  assert.notEqual(first, second);
});
test('ClientSecretCredential uses MSAL token transport and token cache', async () => {
  const credential = new identity.ClientSecretCredential(tenant, client, secret, { disableInstanceDiscovery: true });
  const token = await credential.getToken(scope);
  assert.equal(token.token, 'synthetic-client_credentials-token');
  assert.ok(token.expiresOnTimestamp > Date.now());
  const count = transportCalls.filter(c => c.method === 'POST').length;
  assert.equal(count, 1);
  assert.equal((await credential.getToken(scope)).token, token.token);
  assert.equal(transportCalls.filter(c => c.method === 'POST').length, count);
});
test('EnvironmentCredential delegates to synthetic client-secret authentication', async () => {
  Object.assign(process.env, { AZURE_TENANT_ID: tenant, AZURE_CLIENT_ID: client, AZURE_CLIENT_SECRET: secret });
  const token = await new identity.EnvironmentCredential({ disableInstanceDiscovery: true }).getToken(scope, { tenantId: tenant });
  assert.equal(token.token, 'synthetic-client_credentials-token');
  assert.ok(transportCalls.some(c => c.method === 'POST'));
});
test('ManagedIdentityCredential preserves user-assigned AppService selector', async () => {
  Object.assign(process.env, { IDENTITY_ENDPOINT: 'https://managed-identity.invalid/token', IDENTITY_HEADER: 'synthetic-header-not-a-real-token' });
  const token = await new identity.ManagedIdentityCredential({ clientId: client }).getToken(scope);
  assert.equal(token.token, 'synthetic-managed-token');
  assert.ok(transportCalls.some(c => c.host === 'managed-identity.invalid'));
});
test('AzureCliCredential uses structured argv and rejects unsafe inputs', async () => {
  const credential = new identity.AzureCliCredential({ tenantId: tenant });
  assert.equal((await credential.getToken(scope)).token, 'synthetic-az-token');
  const call = processCalls[0];
  assert.equal(call.file, 'az');
  assert.deepEqual(call.args, ['account', 'get-access-token', '--output', 'json', '--resource', resource, '--tenant', tenant]);
  assert.equal(call.allowWindowsBatchFiles, true);
  const count = processCalls.length;
  assert.throws(() => new identity.AzureCliCredential({ tenantId: 'invalid;tenant' }));
  await assert.rejects(credential.getToken(scope + ';printf'));
  assert.equal(processCalls.length, count);
});
test('AzureDeveloperCliCredential uses structured argv and rejects unsafe inputs', async () => {
  const credential = new identity.AzureDeveloperCliCredential({ tenantId: tenant });
  assert.equal((await credential.getToken(scope)).token, 'synthetic-azd-token');
  const call = processCalls[0];
  assert.equal(call.file, 'azd');
  assert.deepEqual(call.args, ['auth', 'token', '--output', 'json', '--no-prompt', '--scope', scope, '--tenant-id', tenant]);
  assert.equal(call.allowWindowsBatchFiles, true);
  const count = processCalls.length;
  assert.throws(() => new identity.AzureDeveloperCliCredential({ tenantId: 'invalid;tenant' }));
  await assert.rejects(credential.getToken(scope + ';printf'));
  assert.equal(processCalls.length, count);
});
test('AzurePowerShellCredential passes data through private environment into fixed source', async () => {
  const credential = new identity.AzurePowerShellCredential({ tenantId: tenant });
  assert.equal((await credential.getToken(scope)).token, 'synthetic-pwsh-token');
  const call = processCalls.find(c => c.args.includes('-Command'));
  assert.ok(call);
  const source = call.args[call.args.indexOf('-Command') + 1];
  assert.equal(source.includes(tenant), false);
  assert.equal(source.includes(resource), false);
  assert.ok(source.includes('$env:AZURE_IDENTITY_POWERSHELL_TENANT_ID'));
  assert.equal(call.privateTenant, tenant);
  assert.equal(call.privateResource, resource);
  const count = processCalls.length;
  assert.throws(() => new identity.AzurePowerShellCredential({ tenantId: 'invalid;tenant' }));
  await assert.rejects(credential.getToken(scope + ';printf'));
  assert.equal(processCalls.length, count);
});
test('Real VSCE4 auth bridge completes synthetic EnvironmentCredential chain', async () => {
  Object.assign(process.env, { AZURE_TENANT_ID: tenant, AZURE_CLIENT_ID: client, AZURE_CLIENT_SECRET: secret });
  const { getAzureCredentialAccessToken } = require(path.join(path.dirname(fromProject.resolve('@vscode/vsce')), 'auth.js'));
  assert.equal(await getAzureCredentialAccessToken(), 'synthetic-client_credentials-token');
  assert.equal(processCalls.length, 0);
});
test('Real VSCE4 auth bridge falls back to structured AzureCliCredential', async () => {
  Object.assign(process.env, { AZURE_TENANT_ID: tenant, AZURE_CLIENT_ID: client });
  const { getAzureCredentialAccessToken } = require(path.join(path.dirname(fromProject.resolve('@vscode/vsce')), 'auth.js'));
  assert.equal(await getAzureCredentialAccessToken(), 'synthetic-az-token');
  assert.equal(transportCalls.length, 0);
  assert.equal(processCalls[0].file, 'az');
});
test('MSAL advisory regression keeps auth-code exchange on configured authority', async () => {
  const networkClient = {
    async sendGetRequestAsync(url, opts) { return { status: 200, headers: {}, body: responseFor(url, 'GET', opts?.body) }; },
    async sendPostRequestAsync(url, opts) { return { status: 200, headers: {}, body: responseFor(url, 'POST', opts?.body) }; }
  };
  const config = { auth: { clientId: client, clientSecret: secret, authority, authorityMetadata: JSON.stringify(metadata), knownAuthorities: ['login.microsoftonline.com'] }, system: { networkClient } };
  assert.throws(() => new msal.ConfidentialClientApplication({ ...config, auth: { ...config.auth, instanceAware: true } }), error => error.errorCode === 'unsupported_cca_instance_aware');
  const app = new msal.ConfidentialClientApplication(config);
  await assert.rejects(app.getAuthCodeUrl({ scopes: [scope], redirectUri: 'https://callback.invalid/', extraQueryParameters: { instance_aware: 'true' } }), error => error.errorCode === 'unsupported_cca_instance_aware');
  const result = await app.acquireTokenByCode({ code: 'synthetic-request-code', scopes: [scope], redirectUri: 'https://callback.invalid/', state: 'expected-state' }, { code: 'different-payload-code', state: 'expected-state', cloud_instance_host_name: 'attacker.invalid', cloud_graph_host_name: 'attacker.invalid', msgraph_host: 'attacker.invalid' });
  assert.equal(result.accessToken, 'synthetic-authorization_code-token');
  assert.equal(transportCalls.filter(c => c.method === 'POST').length, 1);
  assert.ok(transportCalls.every(c => c.host === 'login.microsoftonline.com'));
});
test('No real network or credential subprocess was attempted', async () => {
  assert.deepEqual(guard, { network: 0, childProcess: 0 });
});
