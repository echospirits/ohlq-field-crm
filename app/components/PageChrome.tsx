import type { ReactNode } from 'react';

type PageHeaderProps = {
  actions?: ReactNode;
  description?: ReactNode;
  eyebrow?: string;
  title: ReactNode;
};

export function PageHeader({ actions, description, title }: PageHeaderProps) {
  return (
    <header className="page-heading page-header">
      <div>
        <h1>{title}</h1>
        {description ? <p className="muted">{description}</p> : null}
      </div>
      {actions ? <div className="page-heading-actions">{actions}</div> : null}
    </header>
  );
}

type SectionHeadingProps = {
  actions?: ReactNode;
  count?: number;
  description?: ReactNode;
  title: ReactNode;
};

export function SectionHeading({ actions, count, description, title }: SectionHeadingProps) {
  return (
    <div className="content-section-heading">
      <div>
        <div className="content-section-title-row">
          <h2>{title}</h2>
          {typeof count === 'number' ? <span className="result-count">{count.toLocaleString()}</span> : null}
        </div>
        {description ? <p className="muted">{description}</p> : null}
      </div>
      {actions ? <div className="content-section-heading-actions">{actions}</div> : null}
    </div>
  );
}

type EmptyStateProps = {
  action?: ReactNode;
  description: ReactNode;
  title: ReactNode;
};

export function EmptyState({ action, description, title }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div>
        <h3>{title}</h3>
        <p className="muted">{description}</p>
      </div>
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  );
}
