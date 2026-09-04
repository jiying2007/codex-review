'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
test('Review defaults to Core Runtime auto discovery with machine-local advanced overrides',()=>{
  const props=pkg.contributes.configuration.properties;
  assert.deepEqual(props['safeCodexReview.providerMode'].enum,['auto','openai','openai-compatible']);
  assert.equal(props['safeCodexReview.providerMode'].default,'auto');
  for(const key of ['providerMode','providerBaseUrl','providerApiKeyEnv','providerCredentialSource','providerAllowInsecureHttp']) assert.equal(props['safeCodexReview.'+key].scope,'machine');
});
test('Review delegates provider inheritance to Core Runtime Contract v3',()=>{
  const source=read('src/policy.js');
  assert.match(source,/codex-runtime-resolver/);
  assert.match(source,/resolveCodexRuntime\(codexRuntimeSelection\)/);
  assert.match(source,/inspectCodexRuntime\(codexRuntimeSelection\)/);
  assert.match(source,/providerMode', 'auto'/);
});
test('managed Model Registry is authoritative over legacy model and fastModel hints',()=>{
  const source=read('src/policy.js');
  assert.match(source,/const managedRouting = Boolean\(modelRegistryResolution\.registry\)/);
  assert.match(source,/managedRouting && modelSelectionStrategy !== 'fixed' \? '' : configuredModel/);
  assert.match(source,/const fastModel = managedRouting \? '' : configuredFastModel/);
  assert.match(source,/registry\?\.digest \|\| registry\?\.revision/);
  assert.match(source,/strategy === 'preference'/);
  assert.match(source,/fixedOrUnmanagedModel/);
  assert.match(source,/unmanagedScoutModel/);
});
test('Review build is content-addressed so repeated CI build hooks reuse identical dist',()=>{
  const source=read('scripts/build.js');
  assert.match(source,/buildInputDigest/);
  assert.match(source,/\.build-input\.sha256/);
  assert.match(source,/distIsReusable/);
  assert.match(source,/build cache hit/);
  assert.match(source,/secure-local-file\.js/);
});
test('Review Doctor exposes Remote Extension Host and redacted runtime source',()=>{
  const source=read('extension.js');
  assert.match(source,/vscode\.env\.remoteName/);
  assert.match(source,/Extension Host:/);
  assert.match(source,/Credential source:/);
  assert.doesNotMatch(source,/credentialLabel\s*=.*\.value/);
});
