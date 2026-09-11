'use client';

type CommunicationLinkProps = {
  accountId: string;
  accountType: 'AGENCY' | 'WHOLESALE';
  contactId: string;
  href: string;
  label: string;
};

export function CommunicationLink({ accountId, accountType, contactId, href, label }: CommunicationLinkProps) {
  return <a
    className="contact-action"
    href={href}
    onClick={() => {
      void fetch('/api/contact-activities', {
        body: JSON.stringify({ accountId, accountType, contactId, kind: href.startsWith('mailto:') ? 'EMAIL_INITIATED' : 'CALL_INITIATED' }),
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        method: 'POST',
      }).catch(() => undefined);
    }}
  >{label}</a>;
}
