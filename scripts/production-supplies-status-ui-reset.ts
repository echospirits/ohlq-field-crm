import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { parseEnvironmentFile } from '../lib/environmentFile';

/** Restore only this isolated synthetic UI fixture's own dismissal assertions. */
async function main() {
  const env = Object.fromEntries(parseEnvironmentFile(readFileSync('.env.supplies.local', 'utf8')));
  const host = 'ep-dry-bird-avmcqwk5-pooler.c-11.us-east-1.aws.neon.tech';
  if (env.APP_ENV !== 'development' || env.DATABASE_ENVIRONMENT !== 'development' || env.DATABASE_TARGET_ID !== 'supplies-rehearsal' || env.EXPECTED_DATABASE_HOST !== host || new URL(env.DATABASE_URL).hostname !== host) throw Error('Only the named isolated rehearsal branch is accepted.');
  const fixture = JSON.parse(readFileSync('output/production-supplies-status-qa.json', 'utf8')) as { synthetic: boolean; rehearsal: boolean; organizationId: string; cardIds: string[]; cards: Array<{ needId: string; material: string }>; sessions: Array<{ role: string; token: string }> };
  if (!fixture.synthetic || !fixture.rehearsal || fixture.organizationId !== 'org_echo_spirits' || !fixture.cards.length || !fixture.cards.every(card => card.material.startsWith('QA '))) throw Error('Explicit synthetic UI fixture required.');
  const session = fixture.sessions.find(item => item.role === 'ADMIN'); if (!session) throw Error('Synthetic admin session required.');
  const db = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
  try {
    const current = await db.userSession.findFirst({ where: { tokenHash: createHash('sha256').update(session.token).digest('hex') }, include: { user: true } });
    if (!current || current.user.organizationId !== fixture.organizationId || current.user.role !== 'ADMIN' || !current.user.email.endsWith('@example.invalid') || !current.user.id.startsWith('status_qa_admin_')) throw Error('Verified synthetic admin required.');
    const needs = await db.supplyNeed.findMany({ where: { organizationId: fixture.organizationId, id: { in: fixture.cardIds } }, select: { id: true, description: true } });
    if (needs.length !== fixture.cardIds.length || needs.some(need => !fixture.cards.some(card => card.needId === need.id && card.material === need.description))) throw Error('Fixture identity mismatch.');
    const result = await db.supplyAudit.deleteMany({ where: { organizationId: fixture.organizationId, needId: { in: fixture.cardIds }, actorUserId: current.user.id, action: 'SUPPLY_STATUS_DISMISSED' } });
    console.log(JSON.stringify({ target: 'supplies-rehearsal', synthetic: true, restoredFixtureDismissals: result.count }));
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Synthetic fixture reset failed.'); process.exitCode = 1; });
