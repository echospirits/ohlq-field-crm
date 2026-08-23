export type VisitLocationType = 'agency' | 'wholesale';
export type VisitFollowUpMode = 'none' | 'task';

export type VisitWorklistCandidate = {
  agencyId: string | null;
  id: string;
  title: string;
  wholesaleAccountId: string | null;
};

export type VisitOutcomeOption = {
  code: string;
  label: string;
};

const sharedOutcomes: VisitOutcomeOption[] = [
  { code: 'met-buyer', label: 'Met buyer' },
  { code: 'buyer-unavailable', label: 'Buyer unavailable' },
  { code: 'sampled-product', label: 'Sampled product' },
  { code: 'product-interest', label: 'Product interest' },
  { code: 'follow-up-needed', label: 'Follow-up needed' },
  { code: 'no-action-needed', label: 'No action needed' },
];

export const wholesaleVisitOutcomes: VisitOutcomeOption[] = [
  ...sharedOutcomes,
  { code: 'discussed-order', label: 'Discussed order' },
  { code: 'menu-opportunity', label: 'Menu opportunity' },
];

export const agencyVisitOutcomes: VisitOutcomeOption[] = [
  ...sharedOutcomes,
  { code: 'discussed-reorder', label: 'Discussed reorder' },
  { code: 'display-opportunity', label: 'Display opportunity' },
];

const outcomesByType: Record<VisitLocationType, VisitOutcomeOption[]> = {
  agency: agencyVisitOutcomes,
  wholesale: wholesaleVisitOutcomes,
};

export const getVisitOutcomes = (visitType: VisitLocationType) => outcomesByType[visitType];

export const getAllowedOutcomeCodes = (visitType: VisitLocationType) =>
  new Set(getVisitOutcomes(visitType).map((outcome) => outcome.code));

export const sanitizeOutcomeCodes = (visitType: VisitLocationType, values: string[]) => {
  const allowed = getAllowedOutcomeCodes(visitType);
  return Array.from(new Set(values.map((value) => value.trim()).filter((value) => allowed.has(value))));
};

export const getOutcomeLabels = (visitType: VisitLocationType, codes: string[]) => {
  const labels = new Map(getVisitOutcomes(visitType).map((outcome) => [outcome.code, outcome.label]));
  return codes.map((code) => labels.get(code)).filter(Boolean) as string[];
};

export const normalizeFollowUpMode = (value: string | null | undefined): VisitFollowUpMode =>
  value === 'later' || value === 'task' ? 'task' : 'none';

export const shouldCreateVisitTask = (mode: VisitFollowUpMode) => mode === 'task';

export const getMatchingVisitWorklistItems = ({
  agencyId,
  items,
  locationType,
  wholesaleAccountId,
}: {
  agencyId: string | null | undefined;
  items: VisitWorklistCandidate[];
  locationType: VisitLocationType;
  wholesaleAccountId: string | null | undefined;
}) => items.filter((item) =>
  locationType === 'agency'
    ? Boolean(agencyId) && item.agencyId === agencyId
    : Boolean(wholesaleAccountId) && item.wholesaleAccountId === wholesaleAccountId,
);

const worklistCompletionPrefix = 'worklistCompletion:';

export const getRequestedWorklistCompletionIds = (entries: Iterable<[string, FormDataEntryValue]>) =>
  Array.from(new Set(Array.from(entries)
    .filter(([key, value]) => key.startsWith(worklistCompletionPrefix) && value === 'complete')
    .map(([key]) => key.slice(worklistCompletionPrefix.length).trim())
    .filter(Boolean)));

export const getVisitTaskEditPlan = (
  mode: VisitFollowUpMode,
  primaryTaskStatus: string | null | undefined,
): 'cancel' | 'create' | 'none' | 'update' => {
  if (mode === 'task') return primaryTaskStatus ? 'update' : 'create';
  return primaryTaskStatus === 'OPEN' || primaryTaskStatus === 'IN_PROGRESS' ? 'cancel' : 'none';
};

export const getVisitOutcomeDisplay = ({
  locationType,
  outcomeCodes,
  legacyOutcomes,
}: {
  locationType: string;
  outcomeCodes: string[];
  legacyOutcomes: string | null;
}) => {
  const type: VisitLocationType = locationType === 'agency' ? 'agency' : 'wholesale';
  const structured = getOutcomeLabels(type, outcomeCodes);
  if (structured.length > 0) return structured;

  return (legacyOutcomes ?? '')
    .replace(/^Quick outcomes:\s*/i, '')
    .split(/,|\n/)
    .map((value) => value.trim())
    .filter(Boolean);
};
