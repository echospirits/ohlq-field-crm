import Link from 'next/link';

export type TagBadgeData = {
  id: string;
  name: string;
  color: string | null;
};

type TagBadgesProps = {
  tags: TagBadgeData[];
  emptyLabel?: string;
};

export function TagBadges({ tags, emptyLabel = 'No tags' }: TagBadgesProps) {
  if (tags.length === 0) {
    return <span className="muted">{emptyLabel}</span>;
  }

  return (
    <div className="tag-badge-list">
      {tags.map((tag) => (
        <Link className="tag-badge" href={`/tags/${tag.id}`} key={tag.id}>
          <span className="tag-swatch" style={{ backgroundColor: tag.color ?? '#7c9cff' }} />
          <span>{tag.name}</span>
        </Link>
      ))}
    </div>
  );
}
