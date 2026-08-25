export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { buildPageMetadata } from '../../../lib/appBrand';
import {
  getEnvironmentLabel,
  getSafeDatabaseTarget,
  getSideEffectPolicy,
  validateRuntimeEnvironment,
} from '../../../lib/appEnvironment';
import { requireAdmin } from '../../../lib/auth';
import { prisma } from '../../../lib/prisma';
import { PageHeader } from '../../components/PageChrome';

export const metadata = buildPageMetadata('Environment Diagnostics');

const display = (enabled: boolean) => (enabled ? 'Enabled' : 'Disabled');

export default async function EnvironmentDiagnosticsPage() {
  await requireAdmin();
  const runtime = validateRuntimeEnvironment();
  const sideEffects = getSideEffectPolicy();
  let databaseStatus = 'Connected';
  try {
    await prisma.$queryRaw`select 1`;
  } catch {
    databaseStatus = 'Connection failed';
  }

  const commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || process.env.GIT_COMMIT_SHA?.slice(0, 12) || 'Local build';

  return (
    <>
      <PageHeader eyebrow="Administration" title="Environment diagnostics" description="Safe deployment identity and side-effect status. Secret values are never displayed." />
      <section className="card admin-panel">
        <dl className="integration-summary">
          <div><dt>Environment</dt><dd>{getEnvironmentLabel()}</dd></div>
          <div><dt>Branch</dt><dd>{runtime.branch ?? 'Local checkout'}</dd></div>
          <div><dt>Commit</dt><dd>{commit}</dd></div>
          <div><dt>Base URL</dt><dd>{runtime.baseUrl}</dd></div>
          <div><dt>Database target</dt><dd>{getSafeDatabaseTarget()}</dd></div>
          <div><dt>Database status</dt><dd>{databaseStatus}</dd></div>
          <div><dt>Cron jobs</dt><dd>{display(sideEffects.cron)}</dd></div>
          <div><dt>Email delivery</dt><dd>{display(sideEffects.email)}</dd></div>
          <div><dt>Calendar sync</dt><dd>{display(sideEffects.calendar)}</dd></div>
          <div><dt>OHLQ imports</dt><dd>{display(sideEffects.ohlqImport)}</dd></div>
          <div><dt>File uploads</dt><dd>{display(sideEffects.fileUploads)}</dd></div>
          <div><dt>Webhook registration</dt><dd>{display(sideEffects.webhookRegistration)}</dd></div>
        </dl>
      </section>
    </>
  );
}
