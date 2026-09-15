import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';

test('the Python CLI does not auto-deploy as a web application', () => {
  const config = JSON.parse(readFileSync(new URL('../ingest/vercel.json', import.meta.url), 'utf8'));
  assert.equal(config.git.deploymentEnabled, false);
  const webConfig = new URL('../vercel.json', import.meta.url);
  if (existsSync(webConfig)) {
    assert.notEqual(JSON.parse(readFileSync(webConfig, 'utf8')).git?.deploymentEnabled, false);
  }
});
