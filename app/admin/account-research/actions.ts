'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getUserDisplayName, requireAdmin } from '../../../lib/auth';
import { importAccountResearchCsv } from '../../../lib/accountResearch';

const returnWith = (values: Record<string, string | number>): never => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) query.set(key, String(value));
  redirect(`/admin/account-research?${query.toString()}`);
};

export async function uploadAccountResearchCsv(formData: FormData) {
  const user = await requireAdmin();
  const file = formData.get('researchFile');
  const dryRun = String(formData.get('mode') ?? 'dry-run') !== 'commit';
  if (!(file instanceof File) || file.size === 0) returnWith({ status: 'missing-file' });
  const researchFile = file as File;
  if (!researchFile.name.toLowerCase().endsWith('.csv')) returnWith({ status: 'invalid-file' });

  try {
    const result = await importAccountResearchCsv({
      csv: await researchFile.text(), dryRun, importedBy: getUserDisplayName(user),
    });
    if (result.errors.length > 0) {
      returnWith({
        status: 'failed', rows: result.parsedRows, errors: result.errors.length,
        detail: result.errors.slice(0, 8).map((error) => `Row ${error.rowNumber}: ${error.message}`).join(' | ').slice(0, 1_500),
      });
    }
    revalidatePath('/admin/account-research');
    revalidatePath('/opportunities');
    revalidatePath('/targets');
    revalidatePath('/alerts');
    revalidatePath('/');
    returnWith({ status: dryRun ? 'dry-run' : 'completed', rows: result.parsedRows, imported: result.importedRows });
  } catch (error) {
    returnWith({ status: 'failed', detail: (error instanceof Error ? error.message : String(error)).slice(0, 1_500) });
  }
}
