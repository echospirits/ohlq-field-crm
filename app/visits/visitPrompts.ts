import type { VisitLocationType } from '../../lib/visitPickerOptions';

export type VisitOutcomePrompt = {
  displayOrder: number;
  followUpField?: 'nextStep' | 'outcomes';
  helperText?: string;
  id: string;
  label: string;
};

const sharedOutcomePrompts: VisitOutcomePrompt[] = [
  { displayOrder: 10, id: 'display-checked', label: 'Display checked' },
  { displayOrder: 20, id: 'menu-checked', label: 'Menu checked' },
  { displayOrder: 30, id: 'staff-trained', label: 'Staff trained' },
  { displayOrder: 40, id: 'order-opportunity', label: 'Order opportunity' },
  { displayOrder: 50, id: 'needs-follow-up', label: 'Needs follow-up', followUpField: 'nextStep' },
  { displayOrder: 60, id: 'no-action-needed', label: 'No action needed' },
];

// Edit these arrays when wholesale and agency visits need different "What happened?" prompts.
// Keep labels stable when possible because selected quick prompts are saved into the visit outcomes text.
export const wholesaleVisitOutcomePrompts: VisitOutcomePrompt[] = [...sharedOutcomePrompts];
export const agencyVisitOutcomePrompts: VisitOutcomePrompt[] = [...sharedOutcomePrompts];

export const defaultVisitOutcomePrompts = sharedOutcomePrompts;

const promptsByVisitType: Record<VisitLocationType, VisitOutcomePrompt[]> = {
  agency: agencyVisitOutcomePrompts,
  wholesale: wholesaleVisitOutcomePrompts,
};

export const getVisitOutcomePrompts = (visitType: VisitLocationType) =>
  [...(promptsByVisitType[visitType] ?? defaultVisitOutcomePrompts)].sort(
    (left, right) => left.displayOrder - right.displayOrder || left.label.localeCompare(right.label),
  );
