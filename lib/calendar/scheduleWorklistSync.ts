import { after } from 'next/server';
import { syncWorklistItemCalendar } from './worklistSync';

export function scheduleWorklistSync(id: string) {
  // Calendar failures must not turn a committed CRM save into a failed request.
  after(async () => {
    try {
      await syncWorklistItemCalendar(id);
    } catch (error) {
      console.error('Post-save worklist calendar sync failed', { worklistItemId: id, error });
    }
  });
}
