import { redirect } from 'next/navigation';
import { isValidSchedulerDate } from '../../lib/myDayWeekScheduler';

export default async function MyWeekPage({ searchParams }: { searchParams?: Promise<{ date?: string }> }) {
  const params = (await searchParams) ?? {};
  const date = isValidSchedulerDate(params.date) ? `&date=${params.date}` : '';
  redirect(`/?view=week${date}`);
}
