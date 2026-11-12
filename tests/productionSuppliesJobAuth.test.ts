import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSupplyJobAuthorized } from '../lib/productionSupplies/jobAuth';
import { GET } from '../app/api/cron/production-supplies/route';

test('native cron and external scheduler can authenticate with separate configured credentials', () => {
  const env = { CRON_SECRET: 'native-fixture-key', SUPPLY_JOB_SECRET: 'supply-fixture-key' };
  assert.equal(isSupplyJobAuthorized('Bearer native-fixture-key', env), true);
  assert.equal(isSupplyJobAuthorized('Bearer supply-fixture-key', env), true);
  assert.equal(isSupplyJobAuthorized('Bearer supply-fixture-key', { SUPPLY_JOB_SECRET: 'supply-fixture-key' }), true);
  assert.equal(isSupplyJobAuthorized('Bearer native-fixture-key', { CRON_SECRET: 'native-fixture-key' }), true);
});

test('unconfigured, missing, wrong and malformed authorization all fail closed', () => {
  const env = { CRON_SECRET: 'native-fixture-key', SUPPLY_JOB_SECRET: 'supply-fixture-key' };
  for (const authorization of [null, '', 'Bearer ', 'supply-fixture-key', 'Basic supply-fixture-key', 'bearer supply-fixture-key', 'Bearer wrong-fixture-key', 'Bearer supply-fixture-key ', 'Bearer supply-fixture-keX']) {
    assert.equal(isSupplyJobAuthorized(authorization, env), false);
  }
  assert.equal(isSupplyJobAuthorized('Bearer undefined', {}), false);
  assert.equal(isSupplyJobAuthorized('Bearer ', { CRON_SECRET: '', SUPPLY_JOB_SECRET: '' }), false);
});

test('cron HTTP route rejects missing or invalid credentials before any database work', async () => {
  const oldCron = process.env.CRON_SECRET, oldSupply = process.env.SUPPLY_JOB_SECRET;
  process.env.CRON_SECRET = 'native-route-fixture';
  process.env.SUPPLY_JOB_SECRET = 'supply-route-fixture';
  try {
    // No database URL/credentials are provisioned for this unit test. A database read would fail.
    for (const authorization of [null, 'Bearer incorrect-route-fixture']) {
      const response = await GET(new Request('http://localhost/api/cron/production-supplies', { headers: authorization ? { authorization } : {} }));
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: 'Unauthorized' });
    }
    for (const authorization of ['Bearer native-route-fixture', 'Bearer supply-route-fixture']) {
      const response = await GET(new Request('http://localhost/api/cron/production-supplies', { headers: { authorization } }));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { environmentDisabled: true });
    }
  } finally {
    if (oldCron === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = oldCron;
    if (oldSupply === undefined) delete process.env.SUPPLY_JOB_SECRET; else process.env.SUPPLY_JOB_SECRET = oldSupply;
  }
});
