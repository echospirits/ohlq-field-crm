import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { cookies, headers } from 'next/headers';
import { ECHO_ORGANIZATION_ID } from './echoAccess';
import { assertStateWrite, combineWhere, modelHasStatePolicy, modelStateWhere, scopeReadArgs, stateWhere, type StateScope } from './accountStatePolicy';

const explicitScope = new AsyncLocalStorage<StateScope | null>();
const requestScopes = new WeakMap<object, Promise<StateScope | null>>();
const readOperations = new Set(['findUnique','findUniqueOrThrow','findFirst','findFirstOrThrow','findMany','count','aggregate','groupBy']);
const whereWrites = new Set(['update','updateMany','updateManyAndReturn','delete','deleteMany','upsert']);
const checkedRecords = new WeakMap<StateScope, Map<string, Set<string>>>();
// These common identity/config reads contain no account relationships. Avoid
// loading the directory solely to authenticate or read scalar configuration.
// Any nested selection remains on the ordinary state-enforcement path.
const identityModels = new Set(['User','UserSession','Organization','OrganizationFeature','OrganizationAuditEvent','OrganizationVendorIdentifier','OrganizationProduct']);
function isIdentityOnlyRead(model: string, operation: string, args: Record<string, unknown>): boolean {
  if (!readOperations.has(operation) || !identityModels.has(model) || modelHasStatePolicy(model)) return false;
  if ('include' in args) {
    const include = args.include;
    return model === 'UserSession' && !('select' in args) && !!include && typeof include === 'object'
      && Object.keys(include).length === 1 && (include as Record<string, unknown>).user === true
      && !modelHasStatePolicy('User');
  }
  if (!('select' in args)) return true;
  const select = args.select;
  if (!select || typeof select !== 'object' || Array.isArray(select)) return false;
  const scalarFields = new Set(Prisma.dmmf.datamodel.models.find(item => item.name === model)?.fields.filter(field => field.kind !== 'object').map(field => field.name));
  return Object.entries(select).every(([name, value]) => scalarFields.has(name) && typeof value === 'boolean');
}
function remember(scope: StateScope, model: string, result: unknown) {
  const records = checkedRecords.get(scope) ?? new Map<string, Set<string>>();
  checkedRecords.set(scope, records);
  const ids = records.get(model) ?? new Set<string>();
  records.set(model, ids);
  for (const row of Array.isArray(result) ? result : [result]) {
    if (row && typeof row === 'object' && 'id' in row && typeof row.id === 'string') ids.add(row.id);
  }
}
async function assertParentReferences(base: PrismaClient, model: string, value: unknown, scope: StateScope) {
  if (!value || typeof value !== 'object') return;
  const data = value as Record<string, unknown>;
  const metadata = Prisma.dmmf.datamodel.models.find(m => m.name === model);
  for (const relation of metadata?.fields ?? []) {
    if (relation.kind !== 'object') continue;
    const restriction = modelStateWhere(relation.type, scope);
    if (!restriction) continue;
    if (relation.relationFromFields?.length === 1 && !['agencyId','wholesaleAccountId'].includes(relation.relationFromFields[0])) {
      const field = relation.relationFromFields[0], raw = data[field];
      const id = raw && typeof raw === 'object' && 'set' in raw ? raw.set : raw;
      if (typeof id === 'string' && !checkedRecords.get(scope)?.get(relation.type)?.has(id)) {
        const key = relation.type[0].toLowerCase() + relation.type.slice(1);
        const delegate = (base as unknown as Record<string, { findFirst(args: unknown): Promise<unknown> }>)[key];
        const parent = await delegate.findFirst({ where: combineWhere({ [relation.relationToFields![0]]: id }, restriction), select: { [relation.relationToFields![0]]: true } });
        if (!parent) throw new Error('This related record is outside your organization’s states.');
        remember(scope, relation.type, parent);
      }
    }
    const nested = data[relation.name] as Record<string, unknown> | undefined;
    if (nested && typeof nested === 'object') {
      const createMany = nested.createMany as { data?: unknown } | undefined;
      const creating = nested.create ?? createMany?.data;
      if (creating) for (const row of Array.isArray(creating) ? creating : [creating]) await assertParentReferences(base, relation.type, row, scope);
    }
  }
}
// Scalar account references predate foreign keys. Limit their IN predicates to
// IDs actually referenced by those tables, rather than repeating every account
// in the statewide directory through each parent relation. This remains an
// allow-list: orphan/unknown and newly concurrent references fail closed.
const referenceQueries = Prisma.dmmf.datamodel.models.flatMap(model => {
  if (['Agency','WholesaleAccount','Account','AccountSalesEvent'].includes(model.name) || model.name.startsWith('Ohlq')) return [];
  const table = model.dbName ?? model.name;
  if (['OrganizationAccountOverlay','AccountTargetingHistory','AccountSalesStatusHistory','ContactImportSession','PlaybookRun','EventShift'].includes(model.name)) {
    const field = ['ContactImportSession','PlaybookRun'].includes(model.name) ? 'accountId' : 'externalAccountId';
    return [`SELECT "${field}" AS id, CASE WHEN "accountType"::text='AGENCY' THEN 'agency' ELSE 'restaurant' END AS kind, '${model.name}' AS model FROM "${table}" WHERE "${field}" IS NOT NULL`];
  }
  return model.fields.filter(field => ['agencyId','wholesaleAccountId'].includes(field.name)
    && !model.fields.some(relation => relation.kind === 'object' && relation.relationFromFields?.includes(field.name)))
    .map(field => `SELECT "${field.dbName ?? field.name}" AS id, '${field.name === 'agencyId' ? 'agency' : 'restaurant'}' AS kind, '${model.name}' AS model FROM "${table}" WHERE "${field.dbName ?? field.name}" IS NOT NULL`);
});
function rememberReferences(scope: StateScope, value: unknown) {
  if (!value || typeof value !== 'object') return;
  for (const [key, raw] of Object.entries(value)) {
    const id = raw && typeof raw === 'object' && 'set' in raw ? raw.set : raw;
    const type = (value as Record<string, unknown>).accountType;
    const kind = key === 'agencyId' ? 'agency' : key === 'wholesaleAccountId' ? 'restaurant'
      : ['externalAccountId','accountId'].includes(key) ? type === 'AGENCY' ? 'agency' : type === 'WHOLESALE' ? 'restaurant' : null : null;
    if (kind && typeof id === 'string') for (const references of Object.values(scope.referencesByModel ?? {})) {
      if (!references[kind].includes(id)) references[kind].push(id);
    }
    if (raw && typeof raw === 'object') rememberReferences(scope, raw);
  }
}
const emptyScope = (): StateScope => ({states:[],agencyIds:[],restaurantIds:[],agencyNumbers:[]});

export type StateAccessOptions = { restrictToConfiguredStates?: boolean };

export async function loadStateScope(base: PrismaClient, organizationId: string, options: StateAccessOptions = {}): Promise<StateScope | null> {
  const organization = await base.organization.findUnique({where:{id:organizationId},select:{enabledStates:true,active:true,accountStatus:true}});
  if (!organization?.active || ['SUSPENDED', 'CANCELLED'].includes(organization.accountStatus)) return emptyScope();
  // Echo's shared sales workflows use the whole directory. Provider jobs can retain their configured coverage.
  if (organizationId === ECHO_ORGANIZATION_ID && !options.restrictToConfiguredStates) return null;
  const states = organization.enabledStates;
  const [retail, restaurants, references] = await Promise.all([
    base.agency.findMany({where:stateWhere(states),select:{id:true,agencyId:true}}),
    base.wholesaleAccount.findMany({where:stateWhere(states),select:{id:true}}),
    base.$queryRawUnsafe<Array<{ id: string; kind: 'agency' | 'restaurant'; model: string }>>(`SELECT DISTINCT id, kind, model FROM (${referenceQueries.join(' UNION ALL ')}) account_references`),
  ]);
  const referencesByModel: NonNullable<StateScope['referencesByModel']> = Object.fromEntries(Prisma.dmmf.datamodel.models.map(model => [model.name, {agency: [], restaurant: []}]));
  for (const row of references) referencesByModel[row.model][row.kind].push(row.id);
  return {states,agencyIds:retail.map(a=>a.id),agencyNumbers:retail.map(a=>a.agencyId),restaurantIds:restaurants.map(a=>a.id), referencesByModel};
}

async function resolveRequestScope(base: PrismaClient): Promise<StateScope | null> {
  const explicit = explicitScope.getStore();
  if (explicit !== undefined) return explicit;
  let store: Awaited<ReturnType<typeof cookies>>;
  try { store = await cookies(); }
  catch (error) {
    // Offline imports/maintenance have no Next request and curate the shared
    // directories. Do not swallow authentication/database errors in requests.
    if (/outside a request scope|requestAsyncStorage|was called outside/i.test(String(error))) return null;
    throw error;
  }
  let result = requestScopes.get(store);
  if (!result) {
    result = (async () => {
      const token = store.get('echo_session')?.value;
      if (!token) {
        const authorization=(await headers()).get('authorization');
        const expected=process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
        if(expected && authorization && Buffer.byteLength(authorization)===Buffer.byteLength(expected) && timingSafeEqual(new TextEncoder().encode(authorization),new TextEncoder().encode(expected)))return null;
        return emptyScope();
      }
      const session=await base.userSession.findFirst({where:{tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:{gt:new Date()},user:{isActive:true,organizationId:ECHO_ORGANIZATION_ID}},include:{user:true}});
      if(!session)return emptyScope();
      const organizationId=session.user.organizationId;
      return organizationId ? loadStateScope(base,organizationId) : emptyScope();
    })();
    requestScopes.set(store,result);
  }
  return result;
}

// Background tenant jobs can opt into the same policy without HTTP cookies.
export async function withOrganizationStateAccess<T>(base: PrismaClient, organizationId: string, work: () => Promise<T>, options?: StateAccessOptions) {
  return explicitScope.run(await loadStateScope(base, organizationId, options), work);
}
export function withAccountStateScope<T>(scope: StateScope, work: () => Promise<T>) { return explicitScope.run(scope,work); }

export function extendWithAccountStateAccess(base: PrismaClient) {
  return base.$extends({ name:'tenant-account-states', query: { $allModels: { async $allOperations({model,operation,args,query}) {
    // Auth/configuration reads must not recurse and need no directory lookup.
    if(['User','UserSession','Organization','OrganizationFeature','OrganizationAuditEvent','OrganizationVendorIdentifier','OrganizationProduct'].includes(model) && !('include' in args) && !('select' in args))return query(args);
    if (isIdentityOnlyRead(model, operation, args as Record<string, unknown>)) return query(args);
    const scope=await resolveRequestScope(base);
    if(!scope)return query(args);
    const values=args as Record<string,unknown>;
    if(readOperations.has(operation)) {
      const result = await query(scopeReadArgs(model,values,scope) as typeof args);
      remember(scope, model, result);
      return result;
    }
    if(whereWrites.has(operation)) {
      const policy=modelStateWhere(model,scope);
      if(policy)values.where=combineWhere(values.where,policy);
    }
    for(const key of ['data','create','update']) {
      const data=values[key];
      if(data)for(const row of Array.isArray(data)?data:[data]) {
        assertStateWrite(model,row,scope,key==='create'||operation.startsWith('create'));
        await assertParentReferences(base,model,row,scope);
      }
    }
    const readSelection = scopeReadArgs(model, values, scope);
    for (const key of ['include','select']) if (key in values) (values as Record<string, unknown>)[key] = readSelection[key];
    const result=await query(args);
    remember(scope,model,result);
    for (const key of ['data','create','update']) rememberReferences(scope, values[key]);
    if(['Agency','WholesaleAccount'].includes(model) && ['create','upsert'].includes(operation) && result && typeof result==='object' && 'id' in result && typeof result.id==='string') {
      const ids=model==='Agency'?scope.agencyIds:scope.restaurantIds;
      if(!ids.includes(result.id))ids.push(result.id);
    }
    return result;
  } } } });
}
