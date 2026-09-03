'use client';

import { useActionState } from 'react';
import { issueInitialAdminInvitationAction, type InvitationActionState } from './actions';

const initialState: InvitationActionState = {};

export function InvitationControls({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useActionState(issueInitialAdminInvitationAction, initialState);
  return <div className="provisioning-invitation-controls">
    <form action={action}>
      <input name="organizationId" type="hidden" value={organizationId} />
      <button disabled={pending} type="submit">{pending ? 'Generating…' : 'Generate or resend invitation'}</button>
    </form>
    {state.error ? <p className="notice danger">{state.error}</p> : null}
    {state.message ? <p className="notice">{state.message}</p> : null}
    {state.manualUrl ? <label>One-time activation link<input onFocus={(event) => event.currentTarget.select()} readOnly value={state.manualUrl} /></label> : null}
  </div>;
}
