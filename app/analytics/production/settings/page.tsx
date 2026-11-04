import Link from 'next/link';
import { requireAdmin } from '../../../../lib/auth';
import { requireOrganizationContext } from '../../../../lib/organizations';
import { getOperationalSignalConfiguration } from '../../../../lib/productionForecasting/operationalSignals/credentials';
import { PageHeader } from '../../../components/PageChrome';
import { SubmitButton } from '../../../components/SubmitButton';
import { checkOpenDockAvailability, configureOpenDock } from './actions';
import { ohioOpenDockWarehouses } from '../../../../lib/productionForecasting/operationalSignals/ohioLocations';
import '../forecast.css';
import '../operational-signals.css';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;
export const metadata = { title: 'Production data connections' };
export default async function ProductionSignalSettings({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const actor = await requireAdmin();
  const { organizationId } = await requireOrganizationContext(actor);
  const { opendock } = await getOperationalSignalConfiguration(organizationId);
  const { status } = await searchParams;
  return <div className="pf-page"><Link href="/analytics/production">← Production Forecasting</Link><PageHeader title="Production data connections" description="Verify the OpenDock warehouses and LTL delivery type for the daily morning check." />
    {status === 'configured' ? <p className="pf-success" role="status">OpenDock credentials and LTL warehouse mappings are configured. Check delivery availability now, or the next morning refresh will record it.</p> : status === 'verification-failed' ? <p className="pf-warning" role="alert">OpenDock verification did not complete. Check the account and API access. Previous credentials and mappings are retained. MFA or SSO may require provider-supported API access.</p> : null}
    <p>{opendock.credentials.configured ? `Credentials saved (${opendock.credentials.usernameHint}).` : 'No OpenDock credentials saved.'} {opendock.configured ? 'Both warehouse mappings are verified.' : 'Warehouse mapping verification is required.'}</p>
    {!opendock.encryption.configured ? <p className="pf-warning" role="status">Credential storage is not configured. An operator must configure a matching encryption key in the application and morning runner before this connection can be saved. Use <code>PRODUCTION_OPERATIONAL_CREDENTIAL_ENCRYPTION_KEY</code>, or the correct existing OHLQ key; do not replace the key protecting existing OPS credentials.</p> : null}
    {status === 'availability-complete' ? <p className="pf-success" role="status">Delivery availability check completed. Existing daily observations were reused when available. <Link href="/analytics/production">View delivery availability</Link></p> : status === 'availability-partial' ? <p className="pf-warning" role="status">One warehouse has a successful daily observation; the other check did not complete. Previous successful observations are retained. <Link href="/analytics/production">Review warehouse status</Link></p> : status === 'availability-failed' ? <p className="pf-warning" role="alert">Delivery availability could not be refreshed. Previous successful observations are retained. Check the account and API access, then retry.</p> : status === 'availability-not-configured' ? <p className="pf-warning" role="alert">Save and verify the OpenDock connection before checking delivery availability.</p> : null}
    <form action={checkOpenDockAvailability} className="pf-operational-form">
      <SubmitButton className="secondary" pendingLabel="Checking GPT and GRN…" disabled={!opendock.configured || !opendock.credentials.configured || !opendock.encryption.configured}>Check delivery availability</SubmitButton>
      <p className="muted">Records today’s first successful GPT and GRN availability checks. Existing daily observations are reused; failed checks can be retried.</p>
      {!opendock.configured || !opendock.credentials.configured ? <p className="muted">Save and verify the connection below to enable this check.</p> : null}
    </form>
    <form action={configureOpenDock} autoComplete="off" className="pf-operational-form">
      <fieldset><legend>Authorized OpenDock account</legend><label>Email<input name="username" type="email" autoComplete="off" /></label><label>Password<input name="password" type="password" autoComplete="new-password" /></label><p className="muted">Leave both fields blank to reuse the saved account. Passwords are encrypted on the server and never returned to this page.</p></fieldset>
      <fieldset><legend>Ohio delivery warehouses</legend>{(['GPT', 'GRN'] as const).map(code => <label key={code}>{code} · {ohioOpenDockWarehouses[code].address}<input name={code} readOnly value={ohioOpenDockWarehouses[code].warehouseId} aria-label={`${code} verified OpenDock warehouse ID`} /></label>)}<p className="muted">These facilities were checked against Echo’s OpenDock favorites. Verification must find one authorized “LTL - Pallet Load” type at each warehouse.</p></fieldset>
      <SubmitButton pendingLabel="Verifying OpenDock…" disabled={!opendock.encryption.configured}>Save and verify OpenDock</SubmitButton>
    </form>
    <details className="compact-details"><summary>Refresh timing and data limits</summary><p>The morning source workflow checks OpenDock and OPS in the background; opening the dashboard reads saved observations. Availability is not a booked appointment.</p><p>OPS reuses the existing encrypted OHLQ account. Agency replenishment is based on the overnight Item Coverage inventory, with source freshness shown separately from the forecast. Same-day shipments and receipts may lag until the next load.</p><p>Calendar days are primary. Business days are shown only when a complete verified operating calendar is supplied; unavailable appointment days are never assumed to be closures.</p></details>
  </div>;
}
