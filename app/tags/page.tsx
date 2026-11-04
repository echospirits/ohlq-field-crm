export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { SubmitButton } from '../components/SubmitButton';
import Link from 'next/link';
import { buildPageMetadata } from '../../lib/appBrand';
import { getUserDisplayName, requireUser } from '../../lib/auth';
import { formatEasternDate } from '../../lib/dateTime';
import { prisma } from '../../lib/prisma';
import { requireOrganizationContext } from '../../lib/organizations';
import { createTag, deleteTag } from './actions';
import { TagBadges } from './TagBadges';
import { AccountViewNavigation } from '../components/AccountViewNavigation';
import { EmptyState, PageHeader, SectionHeading } from '../components/PageChrome';

export const metadata = buildPageMetadata('Tags');

const statusMessages: Record<string, string> = {
  saved: 'Tag saved.',
  deleted: 'Tag deleted.',
  invalid: 'A tag name is required.',
};

export default async function TagsPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string }>;
}) {
  const user = await requireUser();
  const { organizationId } = await requireOrganizationContext(user);
  const params = (await searchParams) ?? {};
  const tags = await prisma.tag.findMany({
    where: { organizationId },
    include: {
      createdByUser: true,
      _count: {
        select: {
          locationTags: true,
        },
      },
    },
    orderBy: [{ name: 'asc' }],
  });

  return (
    <>
      <PageHeader
        eyebrow="Accounts"
        title="Tags"
      />
      <AccountViewNavigation active="tags" />
      {params.status ? <p className="toast-notice page-status">{statusMessages[params.status] ?? params.status}</p> : null}

      <details className="compact-details tag-editor" open={tags.length === 0}>
          <summary>Create or update tag</summary>
          <form action={createTag}>
            <label htmlFor="tag-name">Name</label>
            <input id="tag-name" name="name" placeholder="Priority account, Menu target, Key buyer" required />

            <label htmlFor="tag-color">Color</label>
            <input id="tag-color" name="color" type="color" defaultValue="#885731" />

            <label htmlFor="tag-description">Description</label>
            <textarea id="tag-description" name="description" rows={3} placeholder="How this tag should be used" />

            <SubmitButton type="submit">Save tag</SubmitButton>
          </form>
      </details>

      <section className="content-section">
      <SectionHeading count={tags.length} title="Tag library" />
      {tags.length > 0 ? <div className="table-scroll" role="region" aria-label="Tag library" tabIndex={0}><table className="responsive-table comparison-table tag-library-table">
        <thead>
          <tr>
            <th>Tag</th>
            <th>Description</th>
            <th>Accounts</th>
            <th>Created</th>
            <th>Created By</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {tags.map((tag) => (
            <tr key={tag.id}>
              <td data-label="Tag">
                <TagBadges tags={[tag]} />
              </td>
              <td data-label="Description">{tag.description}</td>
              <td data-label="Accounts" className="numeric">
                <Link href={`/tags/${tag.id}`}>{tag._count.locationTags}</Link>
              </td>
              <td data-label="Created">{formatEasternDate(tag.createdAt)}</td>
              <td data-label="Created By">
                {tag.createdByUser ? getUserDisplayName(tag.createdByUser) : 'Unknown user'}
              </td>
              <td data-label="Actions">
                <div className="action-row">
                  <Link className="btn secondary" href={`/tags/${tag.id}`}>
                    View accounts
                  </Link>
                  <form action={deleteTag}>
                    <input name="id" type="hidden" value={tag.id} />
                    <SubmitButton className="secondary danger-btn" type="submit">
                      Delete
                    </SubmitButton>
                  </form>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div> : <EmptyState description="Create a tag above to start organizing accounts around shared priorities." title="No tags created" />}
      </section>
    </>
  );
}
