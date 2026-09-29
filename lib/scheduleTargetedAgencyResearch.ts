import { after } from 'next/server';
import { refreshTargetedAgencyResearch } from './agencyIntelligenceService';

export function scheduleTargetedAgencyResearch({ agencyId, organizationId }: { agencyId: string; organizationId: string }) {
  after(async () => {
    try {
      await refreshTargetedAgencyResearch({ agencyId, organizationId });
    } catch (error) {
      // A failed refresh must not undo a committed targeting action; the import workflow retries it.
      console.error('Targeted agency intelligence refresh failed', { agencyId, organizationId, error });
    }
  });
}
