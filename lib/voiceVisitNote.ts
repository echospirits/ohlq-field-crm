import { z } from 'zod';
import {
  MAX_TRANSCRIPT_LENGTH,
  type StructuredVisitNote,
  type SuggestedVoiceFollowUp,
  type VoiceVisitType,
} from './voiceVisitNoteShared';

const DEFAULT_TIME_ZONE = 'America/New_York';

const nullableText = z.string().trim().max(1000).nullable();

export const VoiceVisitNoteRequestSchema = z
  .object({
    transcript: z
      .string()
      .trim()
      .min(20, 'Add a little more detail before structuring the visit note.')
      .max(MAX_TRANSCRIPT_LENGTH, `Voice note transcripts must be ${MAX_TRANSCRIPT_LENGTH} characters or less.`),
    visitType: z.enum(['agency', 'wholesale']).optional(),
    accountContext: z
      .object({
        id: z.string().trim().max(120).optional(),
        name: z.string().trim().max(240).optional(),
        identifier: z.string().trim().max(120).optional(),
        city: z.string().trim().max(120).optional(),
        phone: z.string().trim().max(80).optional(),
      })
      .optional()
      .nullable(),
    timezone: z.string().trim().max(80).optional(),
  })
  .strict();

export const VoiceVisitNoteResponseSchema: z.ZodType<StructuredVisitNote> = z
  .object({
    summary: z.string().trim().min(1).max(1200),
    outcomes: z.array(z.string().trim().min(1).max(120)).max(12),
    contactName: nullableText,
    contactRole: nullableText,
    productsDiscussed: z.array(z.string().trim().min(1).max(120)).max(12),
    opportunities: z.array(z.string().trim().min(1).max(240)).max(8),
    objections: z.array(z.string().trim().min(1).max(240)).max(8),
    competitorMentions: z.array(z.string().trim().min(1).max(160)).max(8),
    nextStep: nullableText,
    suggestedFollowUps: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(180),
            description: nullableText,
            dueDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
            dueDateLabel: nullableText,
          })
          .strict(),
      )
      .max(5),
    accountNotes: nullableText,
    suggestedAccountUpdates: z
      .object({
        buyerName: nullableText,
        preferredContactTime: nullableText,
        preferences: nullableText,
      })
      .strict(),
  })
  .strict();

type StructureVisitTranscriptInput = {
  transcript: string;
  visitType?: VoiceVisitType;
  accountName?: string | null;
  actorName?: string | null;
  now?: Date;
  timezone?: string | null;
};

type DueDateSuggestion = {
  dueDate: string | null;
  dueDateLabel: string | null;
};

const numberWords: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const rolePatterns = [
  'owner',
  'buyer',
  'bar manager',
  'beverage director',
  'general manager',
  'gm',
  'manager',
  'bartender',
  'chef',
  'server',
];

const competitorNames = [
  'Titos',
  'Tito',
  'Jameson',
  'Jack Daniels',
  'Jack',
  'Maker',
  'Makers Mark',
  'Bulleit',
  'Bacardi',
  'Patron',
  'Casamigos',
  'Ketel One',
  'Grey Goose',
  'Absolut',
  'Crown Royal',
];

const productStopWords = new Set([
  'about',
  'and',
  'brand',
  'brands',
  'discussed',
  'for',
  'menu',
  'product',
  'products',
  'sampled',
  'talked',
  'the',
  'with',
]);

const normalizeTranscript = (value: string) => value.replace(/\s+/g, ' ').trim();

const splitSentences = (value: string) =>
  value
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

const truncate = (value: string, length: number) => {
  const clean = value.trim();

  return clean.length > length ? `${clean.slice(0, length - 1).trim()}...` : clean;
};

const unique = (values: Array<string | null | undefined>, limit = 8) => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const cleaned = value?.replace(/\s+/g, ' ').trim();

    if (!cleaned) {
      continue;
    }

    const key = cleaned.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(cleaned);

    if (result.length >= limit) {
      break;
    }
  }

  return result;
};

const toTitleCase = (value: string) =>
  value
    .split(/\s+/)
    .map((part) => (part.length > 0 ? `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}` : part))
    .join(' ');

const pickSentences = (sentences: string[], patterns: RegExp[], limit = 4) =>
  unique(
    sentences
      .filter((sentence) => patterns.some((pattern) => pattern.test(sentence)))
      .map((sentence) => truncate(sentence, 220)),
    limit,
  );

const getZonedDateString = (now: Date, timezone: string) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: timezone,
    year: 'numeric',
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));

  return `${parts.year}-${parts.month}-${parts.day}`;
};

const addDays = (dateString: string, days: number) => {
  const date = new Date(`${dateString}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
};

const weekdayForDateString = (dateString: string) => new Date(`${dateString}T12:00:00Z`).getUTCDay();

const numberFromToken = (token: string | undefined) => {
  if (!token) {
    return null;
  }

  const numeric = Number.parseInt(token, 10);

  return Number.isInteger(numeric) ? numeric : numberWords[token.toLowerCase()] ?? null;
};

const getDueDateSuggestion = (text: string, now: Date, timezone: string): DueDateSuggestion => {
  const lower = text.toLowerCase();
  const today = getZonedDateString(now, timezone);

  if (/\b(day after tomorrow)\b/.test(lower)) {
    return { dueDate: addDays(today, 2), dueDateLabel: 'day after tomorrow' };
  }

  if (/\btomorrow\b/.test(lower)) {
    return { dueDate: addDays(today, 1), dueDateLabel: 'tomorrow' };
  }

  const inMatch = lower.match(/\bin\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(day|days|week|weeks)\b/);
  const inAmount = numberFromToken(inMatch?.[1]);

  if (inMatch && inAmount) {
    const days = inMatch[2].startsWith('week') ? inAmount * 7 : inAmount;
    return { dueDate: addDays(today, days), dueDateLabel: inMatch[0] };
  }

  if (/\bnext week\b/.test(lower)) {
    return { dueDate: addDays(today, 7), dueDateLabel: 'next week' };
  }

  const weekdayMatch = lower.match(/\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);

  if (weekdayMatch) {
    const target = weekdays.indexOf(weekdayMatch[2]);
    const current = weekdayForDateString(today);
    const delta = (target - current + 7) % 7 || 7;

    return { dueDate: addDays(today, delta), dueDateLabel: weekdayMatch[0] };
  }

  const looseDate = lower.match(/\b(?:by|on|around)\s+([a-z]+\s+\d{1,2}|\d{1,2}\/\d{1,2})\b/);

  if (looseDate) {
    return { dueDate: null, dueDateLabel: looseDate[1] };
  }

  if (/\b(soon|later|next month|when they are ready|after inventory)\b/.test(lower)) {
    return { dueDate: null, dueDateLabel: RegExp.lastMatch || 'Needs date review' };
  }

  return { dueDate: null, dueDateLabel: null };
};

const extractContactName = (text: string) => {
  const match = text.match(
    /\b(?:met with|spoke with|talked with|talked to|visited with|saw|called|contact was)\s+([a-z][a-z.'-]*(?:\s+[a-z][a-z.'-]*){0,2})/i,
  );
  const rawName = match?.[1]?.replace(/\b(the|a|an|owner|buyer|manager|bar|beverage|director|gm)\b/gi, '').trim();

  if (!rawName || rawName.length < 2) {
    return null;
  }

  return toTitleCase(rawName);
};

const extractContactRole = (text: string) => {
  const lower = text.toLowerCase();
  const role = rolePatterns.find((candidate) => lower.includes(candidate));

  return role ? (role === 'gm' ? 'GM' : toTitleCase(role)) : null;
};

const extractProducts = (sentences: string[]) => {
  const productSentences = sentences.filter((sentence) =>
    /\b(product|products|brand|brands|discussed|talked about|sampled|tasted|menu|cocktail|vodka|bourbon|whiskey|tequila|gin|rum|rye|liqueur|echo)\b/i.test(
      sentence,
    ),
  );
  const candidates = productSentences.flatMap((sentence) => {
    const afterMarker = sentence.match(
      /\b(?:products?|brands?|discussed|talked about|sampled|tasted|featured|poured)\s+(.+?)(?:[.;]|\b(?:and they|but|because|for the|next step)\b|$)/i,
    )?.[1];
    const source = afterMarker ?? sentence;

    return source
      .split(/,| and | plus | with /i)
      .map((part) => part.replace(/[^a-z0-9 &'-.]/gi, ' ').replace(/\s+/g, ' ').trim())
      .filter((part) => {
        const words = part.toLowerCase().split(/\s+/).filter(Boolean);
        return words.length > 0 && words.length <= 5 && words.some((word) => !productStopWords.has(word));
      })
      .map((part) => truncate(part, 80));
  });

  return unique(candidates, 8);
};

const extractCompetitors = (sentences: string[]) => {
  const competitorSentences = sentences.filter((sentence) =>
    /\b(competitor|currently pour|currently pours|currently use|currently uses|using|carries|instead of|versus|vs\.?)\b/i.test(
      sentence,
    ),
  );
  const namedCompetitors = competitorSentences.flatMap((sentence) =>
    competitorNames.filter((competitor) => new RegExp(`\\b${competitor.replace(/\s+/g, '\\s+')}\\b`, 'i').test(sentence)),
  );

  return unique([...namedCompetitors, ...competitorSentences.map((sentence) => truncate(sentence, 160))], 8);
};

const extractOutcomes = (sentences: string[], visitType?: VoiceVisitType) => {
  const tags = [
    { label: 'Menu opportunity', pattern: /\b(menu|cocktail|feature|happy hour)\b/i },
    { label: 'Display opportunity', pattern: /\b(display|shelf|back bar|visibility)\b/i },
    { label: 'Sampling requested', pattern: /\b(sample|tasting|taste|drop off)\b/i },
    { label: 'Order opportunity', pattern: /\b(order|buy|purchase|bring in|add case|case)\b/i },
    { label: 'Follow-up needed', pattern: /\b(follow up|next step|call back|send|check back|revisit)\b/i },
  ];
  const detected = tags.filter((tag) => tag.pattern.test(sentences.join(' '))).map((tag) => tag.label);

  if (visitType === 'agency' && /\b(stock|inventory|shelf|warehouse|delivery)\b/i.test(sentences.join(' '))) {
    detected.push('Agency inventory discussion');
  }

  return unique(detected, 8);
};

const extractNextStep = (sentences: string[]) => {
  const direct = sentences.find((sentence) => /\b(next step|follow up|call back|send|drop off|bring|check back|revisit)\b/i.test(sentence));

  if (!direct) {
    return null;
  }

  return truncate(direct.replace(/^\s*(next step is|next step:)\s*/i, ''), 500);
};

const buildFollowUp = (nextStep: string | null, transcript: string, now: Date, timezone: string): SuggestedVoiceFollowUp[] => {
  if (!nextStep && !/\b(follow up|call back|send|drop off|bring|check back|revisit)\b/i.test(transcript)) {
    return [];
  }

  const dueDate = getDueDateSuggestion(transcript, now, timezone);

  return [
    {
      title: truncate(nextStep ?? 'Follow up from voice visit note', 160),
      description: nextStep ? null : 'Created from the dictated visit note after rep review.',
      dueDate: dueDate.dueDate,
      dueDateLabel: dueDate.dueDateLabel,
    },
  ];
};

export function structureVisitTranscript({
  transcript,
  visitType,
  accountName,
  now = new Date(),
  timezone = DEFAULT_TIME_ZONE,
}: StructureVisitTranscriptInput): StructuredVisitNote {
  const activeTimezone = timezone || DEFAULT_TIME_ZONE;
  const normalized = normalizeTranscript(transcript);
  const sentences = splitSentences(normalized);
  const summaryBase = sentences.slice(0, 2).join(' ') || normalized;
  const opportunities = pickSentences(sentences, [
    /\b(opportunity|interested|wants|asked for|menu|feature|display|sample|tasting|happy hour|seasonal|patio)\b/i,
  ]);
  const objections = pickSentences(sentences, [
    /\b(objection|concern|price|expensive|budget|space|not interested|slow mover|does not sell|already has|contract)\b/i,
  ]);
  const accountNotes = pickSentences(sentences, [
    /\b(prefers|likes|best time|call|text|email|delivery|closed on|busy|decision maker|buyer|preference)\b/i,
  ]);
  const contactName = extractContactName(normalized);
  const contactRole = extractContactRole(normalized);
  const nextStep = extractNextStep(sentences);
  const structured: StructuredVisitNote = {
    summary: truncate(accountName ? `${accountName}: ${summaryBase}` : summaryBase, 1000),
    outcomes: extractOutcomes(sentences, visitType),
    contactName,
    contactRole,
    productsDiscussed: extractProducts(sentences),
    opportunities,
    objections,
    competitorMentions: extractCompetitors(sentences),
    nextStep,
    suggestedFollowUps: buildFollowUp(nextStep, normalized, now, activeTimezone),
    accountNotes: accountNotes.length > 0 ? accountNotes.join(' ') : null,
    suggestedAccountUpdates: {
      buyerName: contactRole?.toLowerCase().includes('buyer') ? contactName : null,
      preferredContactTime: normalized.match(/\b(?:best time|prefers?|call|text)\s+(?:is\s+)?([^.;,]+)/i)?.[1]?.trim() ?? null,
      preferences: accountNotes.find((note) => /\b(prefers|likes|preference)\b/i.test(note)) ?? null,
    },
  };

  return VoiceVisitNoteResponseSchema.parse(structured);
}
