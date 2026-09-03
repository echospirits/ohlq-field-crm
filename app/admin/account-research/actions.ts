'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getUserDisplayName, requirePlatformAdmin } from '../../../lib/auth';
import { importAccountResearchCsv } from '../../../lib/accountResearch';
import { requireFeatureForUser, requireOrganizationContext } from '../../../lib/organizations';

const returnWith = (values: Record<string, string | number>): never => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) query.set(key, String(value));
  redirect(`/admin/account-research?${query.toString()}`);
};

export async function uploadAccountResearchCsv(formData: FormData) {
  const user = await requirePlatformAdmin();
  await requireOrganizationContext(user);
  await requireFeatureForUser(user, 'ADVANCED_INTELLIGENCE');
  const file = formData.get('researchFile');
  const dryRun = String(formData.get('mode') ?? 'dry-run') !== 'commit';
  if (!(file instanceof File) || file.size === 0) returnWith({ status: 'missing-file' });
  const researchFile = file as File;
  if (!researchFile.name.toLowerCase().endsWith('.csv')) returnWith({ status: 'invalid-file' });

  let redirectValues: Record<string, string | number>;
  try {
    const result = await importAccountResearchCsv({
      csv: await researchFile.text(), dryRun, importedBy: getUserDisplayName(user),
    });
    if (result.errors.length > 0) {
      redirectValues = {
        status: 'failed', rows: result.parsedRows, errors: result.errors.length,
        detail: result.errors.slice(0, 8).map((error) => `Row ${error.rowNumber}: ${error.message}`).join(' | ').slice(0, 1_500),
      };
    } else {
      revalidatePath('/admin/account-research');
      revalidatePath('/opportunities');
      revalidatePath('/alerts');
      revalidatePath('/');
      redirectValues = { status: dryRun ? 'dry-run' : 'completed', rows: result.parsedRows, imported: result.importedRows };
    }
  } catch (error) {
    redirectValues = { status: 'failed', detail: (error instanceof Error ? error.message : String(error)).slice(0, 1_500) };
  }
  returnWith(redirectValues);
}
