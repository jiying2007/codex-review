'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const file = path.resolve(__dirname, '../.github/workflows/release-integrity.yml');
const workflow = fs.readFileSync(file, 'utf8');

test('no-op releases do not miscompare the previous immutable tag with a new main SHA', () => {
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /release_admission:/);
  assert.ok(workflow.includes('PUBLISH_JOB_NAME: "Package / attest / publish"'));
  assert.match(workflow, /actions\/runs\/\$\{RELEASE_RUN_ID\}\/jobs\?per_page=100/);
  assert.match(workflow, /total > 100/);
  assert.match(workflow, /success\)/);
  assert.match(workflow, /published=true/);
  assert.match(workflow, /skipped\)/);
  assert.match(workflow, /published=false/);
  assert.match(workflow, /needs: release_admission/);
  assert.ok(workflow.includes("if: ${{ needs.release_admission.outputs.published == 'true' }}"));
  assert.ok(workflow.includes('expected_sha: ${{ github.event.workflow_run.head_sha }}'));
  assert.match(workflow, /consumer-release-integrity\.yml@[0-9a-f]{40}/);
});
