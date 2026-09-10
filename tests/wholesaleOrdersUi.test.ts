import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('order creation uses a stable client request id and persisted download flow', () => {
  const form = readFileSync('app/wholesale/[id]/direct-order/DirectWholesaleOrderForm.tsx', 'utf8');
  const route = readFileSync('app/api/wholesale-orders/pdf/route.ts', 'utf8');
  assert.match(form, /crypto\.randomUUID\(\)/);
  assert.match(form, /requestRef\.current\.fingerprint !== fingerprint/);
  assert.match(form, /clientRequestId: requestRef\.current\.id/);
  assert.match(form, /method: 'POST'/);
  assert.match(form, /'Content-Type': 'application\/json'/);
  assert.match(form, /x-wholesale-order-id/);
  assert.match(form, /\/api\/wholesale-orders\/\$\{completedOrder\.id\}\/pdf/);
  assert.match(form, /disabled=\{submitting\}/);
  assert.match(route, /await request\.json\(\)/);
  assert.doesNotMatch(route, /request\.formData\(\)/);
});

test('customer picker filters the full eligible dataset before capping results', () => {
  const picker = readFileSync('app/wholesale-orders/new/page.tsx', 'utf8');
  assert.match(picker, /isActive: true/);
  assert.match(picker, /mergedIntoId: null/);
  assert.match(picker, /licenseeIds: \{ some:/);
  assert.match(picker, /take: RESULT_LIMIT/);
  assert.match(picker, /href=\{`\/wholesale\/\$\{account\.id\}\/direct-order`\}/);
});

test('order sale and matched report dates use date-only formatting', () => {
  for (const path of ['app/wholesale-orders/page.tsx', 'app/wholesale-orders/[id]/page.tsx', 'app/wholesale/[id]/page.tsx']) {
    const source = readFileSync(path, 'utf8');
    assert.match(source, /formatDateOnly\(order\.saleDate\)/);
    assert.doesNotMatch(source, /formatEasternDate\(order\.saleDate\)/);
  }
  const detail = readFileSync('app/wholesale-orders/[id]/page.tsx', 'utf8');
  assert.match(detail, /formatDateOnly\(order\.matchedReportDate\)/);
});

test('order list is paginated without loading stored PDFs and All clears the status filter', () => {
  const page = readFileSync('app/wholesale-orders/page.tsx', 'utf8');
  const service = readFileSync('lib/wholesaleOrders.ts', 'utf8');
  const viewSelect = service.slice(service.indexOf('const orderViewSelect'), service.indexOf('type OrderWithActors'));
  assert.match(page, /listWholesaleOrders\(\{ organizationId, status, page: requestedPage, pageSize: PAGE_SIZE \}\)/);
  assert.match(page, /href=\{href\(1, null\)\}/);
  assert.doesNotMatch(viewSelect, /pdfBytes/);
});

test('detail offers manual filing for either open status and uses duplicate-safe line keys', () => {
  const detail = readFileSync('app/wholesale-orders/[id]/page.tsx', 'utf8');
  const actions = readFileSync('app/wholesale-orders/actions.ts', 'utf8');
  assert.match(detail, /order\.status !== WholesaleOrderStatus\.FILED/);
  assert.match(detail, />Mark Sent</);
  assert.match(detail, />Mark Filed</);
  assert.match(detail, /key=\{`\$\{line\.itemCode\}-\$\{index\}`\}/);
  assert.doesNotMatch(detail, />Complete</);
  assert.equal((actions.match(/requireFeatureForUser\(user, 'OHIO_DIRECT_WHOLESALE_ORDERS'\)/g) ?? []).length, 2);
  assert.match(actions, /markWholesaleOrderSent\(\{ id, organizationId, actorUserId: user\.id \}\)/);
  assert.match(actions, /markWholesaleOrderFiledManually\(\{ id, organizationId, actorUserId: user\.id \}\)/);
});

test('filed orders join the existing account activity stream including merged sources', () => {
  const account = readFileSync('app/wholesale/[id]/page.tsx', 'utf8');
  const activity = readFileSync('app/visits/VisitActivityTable.tsx', 'utf8');
  assert.match(account, /getMergedWholesaleAccountIds/);
  assert.match(account, /status: WholesaleOrderStatus\.FILED/);
  assert.match(account, /supplementalEvents=\{filedOrders\.map/);
  assert.match(activity, /events\.map/);
  assert.match(activity, /right\.at\.getTime\(\) - left\.at\.getTime\(\)/);
});

test('wholesale order breadcrumbs do not fall through to wholesale accounts', () => {
  const navigation = readFileSync('app/components/AppNavigation.tsx', 'utf8');
  assert.ok(navigation.indexOf("prefix: '/wholesale-orders'") < navigation.indexOf("prefix: '/wholesale'"));
  assert.match(navigation, /href: '\/wholesale-orders', label: 'Wholesale Orders'/);
});
