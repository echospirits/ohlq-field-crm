export const MAX_TRANSCRIPT_LENGTH = 5000;

export type VoiceVisitType = 'agency' | 'wholesale';

export type SuggestedVoiceFollowUp = {
  title: string;
  description: string | null;
  dueDate: string | null;
  dueDateLabel: string | null;
};

export type SuggestedAccountUpdates = {
  buyerName: string | null;
  preferredContactTime: string | null;
  preferences: string | null;
};

export type StructuredVisitNote = {
  summary: string;
  outcomes: string[];
  contactName: string | null;
  contactRole: string | null;
  productsDiscussed: string[];
  opportunities: string[];
  objections: string[];
  competitorMentions: string[];
  nextStep: string | null;
  suggestedFollowUps: SuggestedVoiceFollowUp[];
  accountNotes: string | null;
  suggestedAccountUpdates: SuggestedAccountUpdates;
};

export type VoiceVisitFormFields = {
  summary: string;
  outcomes: string;
  nextStep: string;
};

export type SelectedVoiceFollowUp = {
  title: string;
  description: string | null;
  dueDate: Date | null;
  dueDateLabel: string | null;
};

const toOptional = (value: FormDataEntryValue | null | undefined) => {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toDate = (value: FormDataEntryValue | null | undefined) => {
  const date = toOptional(value);

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }

  return new Date(`${date}T00:00:00`);
};

const listSection = (label: string, values: string[]) => {
  const cleaned = values.map((value) => value.trim()).filter(Boolean);

  return cleaned.length > 0 ? `${label}: ${cleaned.join(', ')}` : null;
};

const objectSection = (label: string, values: Record<string, string | null>) => {
  const cleaned = Object.entries(values)
    .map(([key, value]) => [key, value?.trim()] as const)
    .filter((entry): entry is readonly [string, string] => Boolean(entry[1]));

  return cleaned.length > 0
    ? `${label}: ${cleaned.map(([key, value]) => `${key}: ${value}`).join('; ')}`
    : null;
};

export function buildVisitFieldsFromStructuredNote(note: StructuredVisitNote): VoiceVisitFormFields {
  const outcomes = [
    note.contactName
      ? `Contact mentioned: ${[note.contactName, note.contactRole].filter(Boolean).join(' / ')}`
      : null,
    listSection('Outcomes', note.outcomes),
    listSection('Products discussed', note.productsDiscussed),
    listSection('Opportunities', note.opportunities),
    listSection('Objections', note.objections),
    listSection('Competitor mentions', note.competitorMentions),
    note.accountNotes ? `Account notes to review: ${note.accountNotes}` : null,
    objectSection('Suggested account updates to review', {
      buyerName: note.suggestedAccountUpdates.buyerName,
      preferredContactTime: note.suggestedAccountUpdates.preferredContactTime,
      preferences: note.suggestedAccountUpdates.preferences,
    }),
  ]
    .filter(Boolean)
    .join('\n');

  return {
    summary: note.summary.trim(),
    outcomes,
    nextStep: note.nextStep?.trim() ?? '',
  };
}

export function getSelectedVoiceFollowUps(formData: FormData): SelectedVoiceFollowUp[] {
  const selectedIndexes = new Set(
    formData
      .getAll('voiceFollowUpSelected')
      .map((value) => Number.parseInt(String(value), 10))
      .filter((value) => Number.isInteger(value) && value >= 0),
  );

  if (selectedIndexes.size === 0) {
    return [];
  }

  const titles = formData.getAll('voiceFollowUpTitle');
  const descriptions = formData.getAll('voiceFollowUpDescription');
  const dueDates = formData.getAll('voiceFollowUpDueDate');
  const dueDateLabels = formData.getAll('voiceFollowUpDueDateLabel');
  const maxItems = Math.min(5, Math.max(titles.length, descriptions.length, dueDates.length, dueDateLabels.length));
  const selectedFollowUps: SelectedVoiceFollowUp[] = [];

  for (let index = 0; index < maxItems; index += 1) {
    if (!selectedIndexes.has(index)) {
      continue;
    }

    const title = toOptional(titles[index]);

    if (!title) {
      continue;
    }

    selectedFollowUps.push({
      title: title.slice(0, 180),
      description: toOptional(descriptions[index]),
      dueDate: toDate(dueDates[index]),
      dueDateLabel: toOptional(dueDateLabels[index]),
    });
  }

  return selectedFollowUps;
}
