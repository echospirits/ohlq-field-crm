// Synthetic records rendered through actual daily-work components. No live reads or writes.
// Server actions and provider-dependent controls are inert in these visual fixtures.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { execFileSync } from 'node:child_process';
import { createElement as h, type ReactNode } from 'react';
import ts from 'typescript';

function loadFixture(path: string, mocks: Record<string, unknown>, revision?: string) {
  const filename = resolve(path), nativeRequire = createRequire(filename), exports: Record<string, any> = {};
  const source = (revision ? execFileSync('git', ['show', `${revision}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) : readFileSync(filename, 'utf8')).replace(/action=\{[A-Za-z][A-Za-z0-9]*\}/g, 'action="#fixture"');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(code, { exports, process, URLSearchParams, Date, console, require: (name: string) => name in mocks ? mocks[name] : nativeRequire(name) });
  return exports;
}

const link = { default: ({ children, ...props }: any) => h('a', props, children) };
const displayName = (user: { name?: string; firstName?: string; lastName?: string; email: string }) => user.name || [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
const inert = () => { throw new Error('Visual fixtures must not call server actions'); };
const button = { SubmitButton: ({ children, pendingLabel: _pendingLabel, ...props }: any) => h('button', props, children) };
const actor = { id: 'fixture-rep', name: 'Sam Walker', email: 'sam@example.invalid', role: 'ADMIN' };

export async function buildDailyFixtures(revision?: string): Promise<Record<string, ReactNode>> {
  const load = (path: string, mocks: Record<string, unknown>) => loadFixture(path, mocks, revision);
  const chrome = load('app/components/PageChrome.tsx', {});
  const members = [
    { ...actor, firstName: 'Sam', lastName: 'Walker', phone: '614-555-0100', isActive: true, passwordHash: 'fixture', invitations: [] },
    { id: 'fixture-user-2', firstName: 'Alexandra', lastName: 'Reynolds', name: 'Alexandra Reynolds', email: 'alexandra@example.invalid', phone: '', role: 'USER', isActive: true, passwordHash: 'fixture', invitations: [] },
    { id: 'fixture-user-3', firstName: 'Morgan', lastName: 'Baker', name: 'Morgan Baker', email: 'morgan@example.invalid', phone: '614-555-0103', role: 'TASTER', isActive: false, passwordHash: null, invitations: [{ expiresAt: new Date('2027-01-01T00:00:00Z') }] },
    { id: 'fixture-user-4', firstName: 'Jamie', lastName: 'Patel', name: 'Jamie Patel', email: 'jamie@example.invalid', phone: null, role: 'USER', isActive: false, passwordHash: 'fixture', invitations: [] },
  ];
  const eventModule = load('app/events/ScheduleEvents.tsx', {
    'next/link': link, '../../lib/auth': { getUserDisplayName: displayName },
    '../../lib/prisma': { prisma: {
      eventShift: { findMany: async () => [
        { id: 'fixture-event-1', title: 'Bartender training — Short North accounts', startsAt: new Date('2026-11-06T19:00:00Z'), location: 'Short North tasting room, Columbus', status: 'confirmed', staffUserIds: ['fixture-rep', 'fixture-user-2'] },
        { id: 'fixture-event-2', title: 'Holiday tasting and account follow-up', startsAt: new Date('2026-11-07T18:00:00Z'), location: 'Dublin', status: 'open', staffUserIds: [] },
        { id: 'fixture-event-3', title: 'Restaurant team tasting', startsAt: new Date('2026-11-09T21:00:00Z'), location: null, status: 'confirmed', staffUserIds: ['fixture-user-2'] },
      ] }, user: { findMany: async () => members }, organization: { findUniqueOrThrow: async () => ({ timezone: 'America/New_York' }) },
    } },
    './EventEditor': { EventEditor: () => h('p', { className: 'muted' }, 'Event setup fixture. No event is saved.') },
  });
  const timeline = load('app/visits/ActivityTimelineFilter.tsx', {});
  const activity = load('app/visits/VisitActivityTable.tsx', { 'next/link': link, '../../lib/auth': { getUserDisplayName: displayName }, './ActivityTimelineFilter': timeline });
  let visitHistory;
  try { visitHistory = load('app/visits/VisitHistoryTable.tsx', { 'next/link': link, '../../lib/auth': { getUserDisplayName: displayName }, './ActivityTimelineFilter': timeline, './VisitActivityTable': activity }); }
  catch (error) {
    if (!revision || !(error instanceof Error) || !/fatal: path .* (?:does not exist in|exists on disk, but not in)/.test(error.message)) throw error;
    // The old global history used the same timeline component as account workspaces.
    visitHistory = { VisitHistoryTable: activity.VisitActivityTable };
  }
  const visits = Array.from({ length: 6 }, (_, index) => ({
    id: `fixture-visit-${index}`, visitAt: new Date(Date.UTC(2026, 10, 4 - index, 18, 30)), locationType: index % 2 ? 'agency' : 'wholesale',
    locationName: ['The Columbus Kitchen and Cocktail Room', 'North Market Retail', 'Riverfront Restaurant', 'Dublin Bottle Shop', 'Downtown Hotel Bar', 'West Side Retail'][index],
    locationHref: `/wholesale/fixture-account-${index}`, contactId: index === 0 ? 'fixture-contact' : null,
    contacts: index === 0 ? [{ contact: { id: 'fixture-contact', name: 'Taylor — Beverage Manager' } }] : [],
    summary: ['Buyer requested a rum sample for the winter menu.', 'Reviewed current shelf position and confirmed next tasting.', 'Menu review completed. Follow-up date still to be agreed.', 'Confirmed current inventory with the manager.', null, 'Reviewed the holiday assortment.'][index],
    outcomes: null, outcomeCodes: [], nextStep: index === 0 ? 'Deliver rum samples' : null,
    followUpMode: index === 0 ? 'task' : 'none', followUpDate: index === 0 ? new Date('2026-11-06T00:00:00Z') : null, followUpTimeMinutes: null,
    createdBy: actor.name, createdByUser: actor, photos: [],
    worklistItems: index === 0 ? [{ id: 'fixture-follow-up', title: 'Deliver rum samples', status: 'OPEN' }] : index === 1 ? [{ id: 'fixture-completed', title: 'Confirm tasting date', status: 'COMPLETED' }] : [],
  }));
  const tagBadges = load('app/tags/TagBadges.tsx', { 'next/link': link });
  const accountNav = load('app/components/AccountViewNavigation.tsx', { 'next/link': link });
  const tagsPage = load('app/tags/page.tsx', {
    'next/link': link, '../components/SubmitButton': button, '../components/PageChrome': chrome,
    '../components/AccountViewNavigation': accountNav, './TagBadges': tagBadges,
    '../../lib/auth': { requireUser: async () => actor, getUserDisplayName: displayName },
    '../../lib/organizations': { requireOrganizationContext: async () => ({ organizationId: 'fixture-org' }) },
    '../../lib/prisma': { prisma: { tag: { findMany: async () => ['Priority account', 'Menu opportunity', 'Decision maker met', 'Needs follow-up', 'Seasonal assortment', 'Display target'].map((name, index) => ({ id: `fixture-tag-${index}`, name, color: index % 2 ? '#1b7567' : '#885731', description: ['Active work for the sales team', 'Target for the next menu rotation', 'Buyer relationship confirmed', '', 'Holiday product review', 'In-store display opportunity'][index], createdAt: new Date('2026-10-20T16:00:00Z'), createdByUser: actor, _count: { locationTags: [12, 8, 19, 5, 7, 3][index] } })) } } },
    './actions': { createTag: inert, deleteTag: inert },
  });
  const usersPage = load('app/users/page.tsx', {
    'next/link': link, '../components/SubmitButton': button, '../components/PageChrome': chrome,
    'next/cache': { revalidatePath: inert }, 'next/navigation': { redirect: inert },
    '../../lib/auth': { requireAdminSession: async () => ({ user: actor }), getUserDisplayName: displayName },
    '../../lib/organizations': { requireOrganizationContext: async () => ({ organizationId: 'fixture-org' }) },
    '../../lib/prisma': { prisma: { user: { findMany: async () => members } } },
    '../../lib/password': { hashPassword: inert }, '../../lib/userInvitations': { createUserInvitationToken: inert, sendUserInvitationEmail: inert },
  });
  const visitForm = load('app/visits/LogVisitForm.tsx', {
    './VisitDraft': { VisitDraft: () => null },
    '../components/useCurrentLocation': { useCurrentLocation: () => ({ location: null, status: 'idle', requestLocation: inert }) },
    './VoiceVisitNotePanel': { VoiceVisitNotePanel: () => h('p', null, 'Voice input fixture; no provider request.') },
    './VisitSubmitButton': { VisitSubmitButton: ({ label, disabled }: any) => h('button', { type: 'submit', disabled }, label) },
    './clientPhotoUpload': { useVisitPhotoFormAction: () => ({ formAction: '#fixture', photoUploadError: null }) },
  });
  return {
    'schedule-events': await eventModule.ScheduleEvents({ organizationId: 'fixture-org' }),
    'visit-history': h('section', null, h(chrome.PageHeader, { title: 'Visits', count: visits.length, meta: 'Newest first · Synthetic fixture' }), h(visitHistory.VisitHistoryTable, { visits, contactMap: { 'fixture-contact': 'Taylor — Beverage Manager' } })),
    tags: await tagsPage.default({ searchParams: Promise.resolve({}) }),
    users: await usersPage.default({ searchParams: Promise.resolve({}) }),
    'log-visit': h('section', null, h(chrome.PageHeader, { title: 'Log Visit' }), h(visitForm.LogVisitForm, {
      action: inert, agencies: [], wholesaleAccounts: [{ id: 'fixture-account', licenseeId: '1234567', name: 'The Columbus Kitchen and Cocktail Room', city: 'Columbus', county: 'Franklin', agencyId: null, phone: '614-555-0140', lastVisitAt: null }],
      contacts: [{ id: 'fixture-contact', name: 'Taylor Morgan', role: 'Beverage Manager', phone: '614-555-0141', email: 'taylor@example.invalid', agencyId: null, wholesaleAccountId: 'fixture-account', active: true, isPrimary: true }, { id: 'fixture-contact-2', name: 'Alex Rivera', role: 'General Manager', phone: null, email: null, agencyId: null, wholesaleAccountId: 'fixture-account', active: true, isPrimary: false }],
      actorName: actor.name, currentUserId: actor.id, users: members.map((member) => ({ id: member.id, name: member.name, email: member.email })),
      initialValues: { locationType: 'wholesale', wholesaleAccountId: 'fixture-account', locationLocked: true, sourceLabel: 'Menu follow-up', productName: 'Echo Spirits Rum', productItemCode: 'ECHO-RUM', reason: 'Buyer requested a winter menu tasting.', summary: 'Reviewed the winter cocktail menu with Taylor.', followUpMode: 'task', nextStep: 'Deliver rum samples', followUpDate: '2026-11-06', contactIds: ['fixture-contact'], returnTo: '/alerts' },
    })),
  };
}
