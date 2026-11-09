import { prisma } from '../lib/prisma';
import { validateRuntimeEnvironment, getSafeDatabaseTarget } from '../lib/appEnvironment';
import { getOrganizationOperationalCredentials, requireOperationalSignalOrganization, openDockConfiguration } from '../lib/productionForecasting/operationalSignals/credentials';
import { OpenDockReadClient } from '../lib/productionForecasting/operationalSignals/opendock';

let phase = 'target-validation';
async function main() {
  const runtime = validateRuntimeEnvironment();
  if (runtime.appEnvironment !== 'production' || getSafeDatabaseTarget() !== 'neon-ohlq-field-crm-prod'
    || new URL(process.env.DATABASE_URL!).hostname !== 'ep-proud-recipe-amosj8m9-pooler.c-5.us-east-1.aws.neon.tech') throw new Error('Unexpected diagnostic target.');
  phase = 'configuration';
  const organizationId = 'org_echo_spirits';
  const organization = await requireOperationalSignalOrganization(organizationId, prisma);
  const config = openDockConfiguration(organization.settings);
  phase = 'credentials';
  const credentials = await getOrganizationOperationalCredentials(organizationId, 'OPENDOCK', prisma);
  if (!config.configured || !credentials) throw new Error('Verified provider configuration unavailable.');
  phase = 'provider-lookup';
  const client = new OpenDockReadClient(credentials, { request: async (input, init) => {
    const operation = new URL(String(input)).pathname === '/auth/login' ? 'login' : 'availability';
    const startedAt = Date.now();
    try {
      const response = await fetch(input, init);
      const retryAfter = response.headers.get('retry-after');
      const retryAfterSeconds = retryAfter && /^\d{1,6}$/.test(retryAfter) ? Number(retryAfter) : null;
      const retryAfterDate = retryAfter && !/^\d+$/.test(retryAfter) && Number.isFinite(Date.parse(retryAfter)) ? new Date(retryAfter).toISOString() : null;
      console.log(JSON.stringify({ operation, httpStatus: response.status, elapsedMs: Date.now() - startedAt, retryAfterSeconds, retryAfterDate }));
      return response;
    } catch (error) {
      console.log(JSON.stringify({ operation, transportFailure: true, elapsedMs: Date.now() - startedAt }));
      throw error;
    }
  } });
  for (const location of config.locations) {
    if (!['GPT', 'GRN'].includes(location.locationCode)) throw new Error('Unexpected warehouse.');
    console.log(JSON.stringify({ checking: location.locationCode }));
    const result = await client.availability(location);
    console.log(JSON.stringify({ location: location.locationCode, status: result.status, diagnosticCode: result.diagnosticCode }));
  }
}
main().catch(() => { console.error(JSON.stringify({ failedPhase: phase })); process.exitCode = 1; }).finally(() => prisma.$disconnect());
