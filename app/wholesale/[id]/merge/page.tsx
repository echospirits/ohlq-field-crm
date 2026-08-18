export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireAdmin } from '../../../../lib/auth';
import { prisma } from '../../../../lib/prisma';
import {
  getWholesaleAccountMergePreview,
  getWholesaleMergeCandidates,
  WholesaleMergeError,
} from '../../../../lib/wholesaleAccountMerge';
import { formatWholesaleLicenseeIds } from '../../../../lib/wholesaleAccounts';
import { mergeWholesaleAccountAction } from './actions';
import { PageHeader } from '../../../components/PageChrome';

const statusMessages: Record<string, string> = {
  'already-merged': 'This manual account has already been merged.',
  'confirmation-required': 'Confirm that you understand the merge is permanent before continuing.',
  'invalid-source': 'The manual account could not be found.',
  'invalid-target': 'The official account could not be found.',
  'same-account': 'Choose a different destination account.',
  'source-is-official': 'Only a non-official account can be used as the merge source.',
  'target-has-target-data-conflict':
    'Both accounts contain target intelligence. Resolve that data before merging.',
  'target-is-not-official': 'Choose an active destination with a real Licensee ID.',
};

const formatAddress = (account: {
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}) => [account.address, account.city, account.state, account.zip].filter(Boolean).join(', ') || 'Not provided';

export default async function MergeWholesaleAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ q?: string; status?: string; targetId?: string }>;
}) {
  await requireAdmin();
  const { id: sourceId } = await params;
  const query = (await searchParams) ?? {};
  const q = (query.q ?? '').trim();

  const source = await prisma.wholesaleAccount.findUnique({
    where: { id: sourceId },
    include: {
      licenseeIds: {
        orderBy: [{ isPrimary: 'desc' }, { licenseeId: 'asc' }],
        select: { licenseeId: true },
      },
    },
  });

  if (!source) notFound();
  if (source.mergedIntoId) redirect(`/wholesale/${source.mergedIntoId}`);

  const candidateResults = await getWholesaleMergeCandidates({ query: q, source });
  const { candidates } = candidateResults;

  let preview: Awaited<ReturnType<typeof getWholesaleAccountMergePreview>> | null = null;
  let previewError: string | null = null;
  if (query.targetId) {
    try {
      preview = await getWholesaleAccountMergePreview(sourceId, query.targetId);
    } catch (error) {
      previewError =
        error instanceof WholesaleMergeError
          ? error.message
          : 'The merge preview could not be prepared.';
    }
  }

  return (
    <>
      <PageHeader
        actions={<Link className="btn secondary" href={`/wholesale/${sourceId}`}>Back to account</Link>}
        description="Move activity from a manually created account into its official OHLQ account. The manual record will become an inactive redirect."
        eyebrow="Administrative workflow"
        title="Merge wholesale account"
      />

      {query.status ? (
        <p className="toast-notice" role="status">
          {statusMessages[query.status] ?? query.status}
        </p>
      ) : null}
      {previewError ? <p className="danger-text">{previewError}</p> : null}

      <div className="workflow-shell"><div className="card account-detail-list">
        <h2>Manual source account</h2>
        <p>
          <strong>Name</strong>
          <span>{source.name}</span>
        </p>
        <p>
          <strong>Licensee IDs</strong>
          <span>{formatWholesaleLicenseeIds(source)}</span>
        </p>
        <p>
          <strong>Address</strong>
          <span>{formatAddress(source)}</span>
        </p>
        {source.officialAccountId ? (
          <p className="danger-text">This account is already official and cannot be used as the merge source.</p>
        ) : null}
      </div>

      {!source.officialAccountId ? (
        <>
          <div className="card">
            <h2>Choose the official destination</h2>
            <p className="muted">
              Likely matches are ranked using the source name and address. Search checks every eligible wholesale
              account, including real Licensee-ID accounts that are not linked to a legacy official record.
            </p>
            <form action={`/wholesale/${sourceId}/merge`} method="get">
              <label>
                Search by name, Licensee ID, address, or city
                <input defaultValue={q} name="q" placeholder="Search official accounts" />
              </label>
              <button className="compact-btn secondary" type="submit">
                Search
              </button>
            </form>

            <h3>{q ? 'Search results' : 'Likely matches'}</h3>
            <p className="muted">
              {q
                ? `${candidateResults.matchCount} match${candidateResults.matchCount === 1 ? '' : 'es'} found across ${candidateResults.eligibleCount} eligible destinations.`
                : `Showing the ${Math.min(candidates.length, candidateResults.eligibleCount)} most likely of ${candidateResults.eligibleCount} eligible destinations.`}
            </p>

            <div className="table-scroll">
              <table className="responsive-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Licensee IDs</th>
                    <th>Address</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((candidate, index) => (
                    <tr key={candidate.id}>
                      <td data-label="Account">
                        {candidate.name} {!q && index === 0 ? <span className="pill">Best match</span> : null}
                      </td>
                      <td data-label="Licensee IDs">{formatWholesaleLicenseeIds(candidate)}</td>
                      <td data-label="Address">{formatAddress(candidate)}</td>
                      <td data-label="Action">
                        <Link
                          className="btn compact-btn secondary"
                          href={`/wholesale/${sourceId}/merge?targetId=${candidate.id}&q=${encodeURIComponent(q)}`}
                        >
                          Preview merge
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {candidates.length === 0 ? <p className="muted">No official accounts match that search.</p> : null}
          </div>

          {preview ? (
            <div className="card danger-zone">
              <h2>Merge preview</h2>
              <p>
                <strong>{source.name}</strong> will be merged into <strong>{preview.target.name}</strong>.
              </p>

              <div className="table-scroll">
                <table className="responsive-table">
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>Manual source</th>
                      <th>Final official value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['Name', source.name, preview.target.name],
                      ['Address', source.address, preview.destinationFallbacks.address],
                      ['City', source.city, preview.destinationFallbacks.city],
                      ['Phone', source.phone, preview.destinationFallbacks.phone],
                      ['Agency ID', source.agencyId, preview.destinationFallbacks.agencyId],
                      ['Ownership', source.ownership, preview.destinationFallbacks.ownership],
                    ].map(([label, sourceValue, finalValue]) => (
                      <tr key={label}>
                        <td data-label="Field">{label}</td>
                        <td data-label="Manual source">{sourceValue || 'Not provided'}</td>
                        <td data-label="Final official value">{finalValue || 'Not provided'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="table-scroll">
                <table className="responsive-table">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Records moving</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(preview.counts).map(([label, count]) => (
                      <tr key={label}>
                        <td data-label="Data">
                          {label.replace(/([A-Z])/g, ' $1').replace(/^./, (value) => value.toUpperCase())}
                        </td>
                        <td data-label="Records moving">{count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p>
                <strong>Final Licensee IDs:</strong> {preview.licenseeIds.join(', ')}
              </p>
              <p className="muted">
                Official identity remains canonical. Blank operational fields on the destination are filled from the
                manual account.
              </p>

              {preview.blockers.length > 0 ? (
                <div>
                  <h3>Merge blocked</h3>
                  {preview.blockers.map((blocker) => (
                    <p className="danger-text" key={blocker}>
                      {blocker}
                    </p>
                  ))}
                </div>
              ) : (
                <form action={mergeWholesaleAccountAction}>
                  <input name="sourceId" type="hidden" value={sourceId} />
                  <input name="targetId" type="hidden" value={preview.target.id} />
                  <label>
                    <input name="confirmation" required type="checkbox" value="MERGE" /> I understand that all linked
                    activity will move to {preview.target.name}.
                  </label>
                  <button className="compact-btn danger-btn" type="submit">
                    Merge into official account
                  </button>
                </form>
              )}
            </div>
          ) : null}
        </>
      ) : null}
      </div>
    </>
  );
}
