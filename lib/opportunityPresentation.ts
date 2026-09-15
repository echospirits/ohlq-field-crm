import type { Prisma } from '@prisma/client';

export type OpportunityScoreComponent = {
  key: string;
  label: string;
  points: number;
};

const COMPONENT_LABELS: Record<string, string> = {
  demand: 'Category demand',
  price: 'Price fit',
  'Ohio affinity': 'Ohio-brand affinity',
  'public fit': 'Public fit',
  relationship: 'Relationship',
  urgency: 'Urgency',
  peers: 'Similar buyers',
  learning: 'Learned outcomes',
  worklist: 'Open-work penalty',
};

export const opportunityFactors = (value: Prisma.JsonValue): string[] =>
  Array.isArray(value) ? value.map(String).filter(Boolean) : [];

export function parseOpportunityScoreComponents(factors: string[]): OpportunityScoreComponent[] {
  const summary = factors.find((factor) => factor.startsWith('Score components:'));
  if (!summary) return [];

  return [...summary.matchAll(/(?:Score components:\s*)?([A-Za-z ]+?)\s+(-?\d+(?:\.\d+)?)(?=,|;|$)/g)]
    .map((match) => {
      const key = match[1].trim();
      const rawPoints = Number(match[2]);
      const points = key === 'worklist' && rawPoints > 0 ? -rawPoints : rawPoints;
      return { key, label: COMPONENT_LABELS[key] ?? key, points };
    })
    .filter((component) => Number.isFinite(component.points));
}

export const opportunityEvidence = (factors: string[]) =>
  factors.filter((factor) => !factor.startsWith('Score components:'));
