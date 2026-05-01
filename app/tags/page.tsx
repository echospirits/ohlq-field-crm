export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import Link from 'next/link';
import { getUserDisplayName, requireUser } from '../../lib/auth';
import { prisma } from '../../lib/prisma';
import { createTag, deleteTag } from './actions';
import { TagBadges } from './TagBadges';

const statusMessages: Record<string, string> = {
  saved: 'Tag saved.',
  deleted: 'Tag deleted.',
  invalid: 'A tag name is required.',
};

const formatDate = (date: Date) => new Date(date).toLocaleDateString();

export default async function TagsPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string }>;
}) {
  await requireUser();
  const params = (await searchParams) ?? {};
  const tags = await prisma.tag.findMany({
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
      <h1>Tags</h1>
      <p className="muted">Create reusable account tags, choose their colors, and audit where they are applied.</p>
      {params.status ? <p className="pill">{statusMessages[params.status] ?? params.status}</p> : null}

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

      <table className="responsive-table">
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
              <td data-label="Created">{formatDate(tag.createdAt)}</td>
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
      </table>
    </>
  );
}
