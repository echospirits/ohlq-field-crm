import { PageHeader } from '../../components/PageChrome';

export default function WeeklyDigestLoading() {
  return <>
    <PageHeader eyebrow="Administration" title="Weekly Digest" description="One shared brief for your tenant." />
    <section className="card" role="status" aria-busy="true">
      <h2>Preparing your tenant brief</h2>
      <p className="muted">Reading this week's sales and activity, then summarizing wholesale and retail wins and risks.</p>
    </section>
  </>;
}
