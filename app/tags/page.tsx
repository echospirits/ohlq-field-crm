export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
        description="Create reusable account tags, choose their colors, and audit where they are applied."
        eyebrow="Accounts"
        title="Tags"
      />
      <AccountViewNavigation active="tags" />
      {params.status ? <p className="toast-notice page-status">{statusMessages[params.status] ?? params.status}</p> : null}

      <div className="grid">
        <div className="card">
          <h2>Create / update tag</h2>
          <form action={createTag}>
            <label>Name</label>
            <input name="name" placeholder="Priority account, Menu target, Key buyer" required />

            <label>Color</label>
            <input name="color" type="color" defaultValue="#7c9cff" />

            <label>Description</label>
            <textarea name="description" rows={3} placeholder="How this tag should be used" />

            <button type="submit">Save tag</button>
          </form>
        </div>

        <div className="card">
          <h2>Useful tag ideas</h2>
          <div className="tag-idea-list">
            <span>High priority</span>
            <span>Menu opportunity</span>
            <span>Display target</span>
            <span>Decision maker met</span>
            <span>Needs follow-up</span>
            <span>Do not contact</span>
          </div>
        </div>
      </div>

      <section className="content-section">
      <SectionHeading count={tags.length} description="Reusable labels available across agency and wholesale workspaces." title="Tag library" />
      {tags.length > 0 ? <div className="table-scroll"><table className="responsive-table">
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
              <td data-label="Accounts">
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
                    <button className="secondary" type="submit">
                      Delete
                    </button>
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
