'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '../../components/ActionForm';
import { requireUser } from '../../../lib/auth';
import { requireOrganizationContext } from '../../../lib/organizations';
import { isSupportedOperatingHoursText, OPERATING_HOURS_DAYS, type OperatingHoursDay } from '../../../lib/operatingHours';
import { prisma } from '../../../lib/prisma';
import { assertAccountResearchPilotEnabled } from '../../../lib/accountResearchOpenAI';
import { ACCOUNT_RESEARCH_PILOT_MODEL } from '../../../lib/accountResearchPilot';
import { normalizeUsState, US_STATES } from '../../../lib/usStates';

const hoursResearchSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    exactLocation: { type: 'boolean' },
    matchedName: { type: 'string' },
    matchedAgencyNumber: { type: 'string' },
    matchedAddress: { type: 'string' },
    sourceName: { type: 'string' },
    sourceUrl: { type: 'string' },
    schedule: {
      type: 'array',
      maxItems: 7,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { day: { type: 'string', enum: [...OPERATING_HOURS_DAYS] }, hours: { type: 'string' } },
        required: ['day', 'hours'],
      },
    },
  },
  required: ['exactLocation', 'matchedName', 'matchedAgencyNumber', 'matchedAddress', 'sourceName', 'sourceUrl', 'schedule'],
} as const;

const addressAliases: Record<string, string> = {
  street: 'st', road: 'rd', avenue: 'ave', boulevard: 'blvd', highway: 'hwy', drive: 'dr', lane: 'ln', route: 'rt',
};
const normalizeIdentity = (value: string) => value.toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/\b(?:street|st\.?|road|rd\.?|avenue|ave\.?|boulevard|blvd\.?|highway|hwy\.?|drive|dr\.?|lane|ln\.?|route|rt\.?)\b/g, (word) => addressAliases[word.replace(/\.$/, '')] ?? word.replace(/\.$/, ''))
  .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');

type AgencyHoursResearchOutput = {
  exactLocation?: unknown;
  matchedName?: unknown;
  matchedAgencyNumber?: unknown;
  matchedAddress?: unknown;
  sourceName?: unknown;
  sourceUrl?: unknown;
  schedule?: Array<{ day?: unknown; hours?: unknown }>;
};

type AgencyHoursSearchResult = {
  result: AgencyHoursResearchOutput;
  sourceUrls: string[];
};

async function searchAgencyHours(apiKey: string, input: string, allowedDomains?: string[]): Promise<AgencyHoursSearchResult | null> {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      model: ACCOUNT_RESEARCH_PILOT_MODEL,
      store: false,
      input,
      tools: [{
        type: 'web_search',
        ...(allowedDomains ? { filters: { allowed_domains: allowedDomains } } : {}),
        search_context_size: 'low',
      }],
      max_tool_calls: 2,
      max_output_tokens: 900,
      reasoning: { effort: 'low' },
      text: { verbosity: 'low', format: { type: 'json_schema', name: 'agency_business_hours', strict: true, schema: hoursResearchSchema } },
      include: ['web_search_call.action.sources'],
    }),
  });
  const payload = await response.json() as {
    status?: string;
    output?: Array<{ type?: string; action?: { sources?: Array<{ url?: string }> }; content?: Array<{ type?: string; text?: string }> }>;
  };
  if (!response.ok) throw new Error('Public-hours search failed.');
  const outputText = payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === 'output_text' && item.text)?.text;
  if (payload.status !== 'completed' || !outputText) return null;
  let result: AgencyHoursResearchOutput;
  try { result = JSON.parse(outputText) as AgencyHoursResearchOutput; } catch { return null; }
  const sourceUrls = (payload.output ?? []).filter((item) => item.type === 'web_search_call')
    .flatMap((item) => item.action?.sources ?? []).map((source) => source.url).filter((url): url is string => Boolean(url));
  return { result, sourceUrls };
}

function matchesAgencyAddress(agency: { address: string | null; city: string | null; state: string | null; zip: string | null }, matchedAddressInput: string): boolean {
  const matchedAddress = normalizeIdentity(matchedAddressInput);
  const addressTokens = normalizeIdentity(agency.address ?? '').split(' ');
  const cityMatches = agency.city ? matchedAddress.includes(normalizeIdentity(agency.city)) : false;
  const stateCode = normalizeUsState(agency.state ?? '');
  const stateName = US_STATES.find((state) => state.code === stateCode)?.name;
  const matchedAddressTokens = matchedAddress.split(' ');
  const stateMatches = stateCode ? matchedAddressTokens.includes(stateCode.toLowerCase()) || Boolean(stateName && matchedAddress.includes(normalizeIdentity(stateName))) : false;
  const zipInSource = matchedAddress.match(/\b\d{5}\b/)?.[0];
  const zipMatches = !agency.zip || !zipInSource || zipInSource === agency.zip.replace(/\D/g, '').slice(0, 5);
  return addressTokens.length >= 2 && matchedAddress.includes(addressTokens.join(' ')) && cityMatches && stateMatches && zipMatches;
}

function hasVerifiableSource(result: AgencyHoursResearchOutput, sourceUrls: string[]): URL | null {
  const sourceUrl = typeof result.sourceUrl === 'string' ? result.sourceUrl : '';
  if (typeof result.sourceName !== 'string' || !result.sourceName.trim() || !sourceUrls.includes(sourceUrl)) return null;
  try {
    const parsed = new URL(sourceUrl);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed : null;
  } catch {
    return null;
  }
}

function hasUsableSchedule(result: AgencyHoursResearchOutput): boolean {
  const schedule = result.schedule ?? [];
  return schedule.length > 0 && !schedule.some((entry) => typeof entry.day !== 'string'
    || !OPERATING_HOURS_DAYS.includes(entry.day as OperatingHoursDay)
    || typeof entry.hours !== 'string'
    || !isSupportedOperatingHoursText(entry.hours));
}

function isOhlqLocationUrl(sourceUrl: URL): boolean {
  const sourceHost = sourceUrl.hostname.toLowerCase();
  return (sourceHost === 'ohlq.com' || sourceHost.endsWith('.ohlq.com')) && /^\/locations\/[^/]+\/?$/.test(sourceUrl.pathname);
}

export async function saveAgencyOperatingHours(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  await requireOrganizationContext(user);
  const agencyId = String(formData.get('agencyId') ?? '').trim();
  if (!agencyId || !(await prisma.agency.findUnique({ where: { id: agencyId }, select: { id: true } }))) {
    return { error: 'This agency is no longer available. Refresh the page and try again.' };
  }

  const schedule = [];
  for (const day of OPERATING_HOURS_DAYS) {
    const hours = String(formData.get(`hours.${day}`) ?? '').trim();
    if (!hours) continue;
    if (hours.length > 120 || !isSupportedOperatingHoursText(hours)) {
      return { error: `Enter ${day} as a time range, “Closed,” or “Open 24 hours.”` };
    }
    schedule.push({ day, hours });
  }

  await prisma.agency.update({ where: { id: agencyId }, data: { businessHours: { schedule, sourceType: 'manual' } } });
  revalidatePath(`/agencies/${agencyId}`);
  revalidatePath('/alerts');
  revalidatePath('/');
  return { success: 'Agency operating hours saved.' };
}

export async function researchAgencyOperatingHours(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  await requireOrganizationContext(user);
  const agencyId = String(formData.get('agencyId') ?? '').trim();
  const agency = agencyId ? await prisma.agency.findUnique({
    where: { id: agencyId },
    select: { id: true, agencyId: true, name: true, address: true, city: true, state: true, zip: true },
  }) : null;
  if (!agency) return { error: 'This agency is no longer available. Refresh the page and try again.' };
  if (!agency.address?.trim() || !agency.city?.trim() || !agency.state?.trim()) {
    return { error: 'Add the agency street address, city, and state before researching hours.' };
  }

  let apiKey: string;
  try {
    ({ apiKey } = assertAccountResearchPilotEnabled());
  } catch {
    return { error: 'Public-hours research is unavailable. You can still enter the hours manually.' };
  }

  try {
    const location = [agency.address, agency.city, agency.state, agency.zip].filter(Boolean).join(', ');
    const agencyIdentity = `Ohio agency number: ${agency.agencyId}\nAccount name: ${agency.name}\nAddress: ${location}`;
    const ohlqSearch = await searchAgencyHours(apiKey, `Search the official OHLQ site-wide search for this exact Ohio agency number (do not use the Locations map filter, which does not accept agency numbers). Open the matching official location detail page and use its listed Hours. This search is restricted to OHLQ. Return the Agency # and full street address, city, and state shown on that page. Return the detail page URL as sourceUrl. Do not use a similarly named location. Include only days and hours explicitly listed by the source. Use a 12-hour range such as "9:00 AM–5:00 PM", "Closed", or "Open 24 hours". Leave the schedule empty if the exact agency page or its hours cannot be confirmed.\n\n${agencyIdentity}`, ['ohlq.com']);
    const ohlqSource = ohlqSearch ? hasVerifiableSource(ohlqSearch.result, ohlqSearch.sourceUrls) : null;
    const ohlqAgencyNumber = typeof ohlqSearch?.result.matchedAgencyNumber === 'string' ? ohlqSearch.result.matchedAgencyNumber.replace(/\D/g, '') : '';
    const ohlqAddressMatches = typeof ohlqSearch?.result.matchedAddress === 'string' && matchesAgencyAddress(agency, ohlqSearch.result.matchedAddress);
    const exactOhlqResult = Boolean(ohlqSearch && ohlqSource && isOhlqLocationUrl(ohlqSource)
      && ohlqAgencyNumber === agency.agencyId.replace(/\D/g, '') && ohlqAddressMatches && hasUsableSchedule(ohlqSearch.result));

    const research = exactOhlqResult ? ohlqSearch : await searchAgencyHours(apiKey, `Find current weekly hours for this exact business location using Google Maps, its own official site, or another credible public listing. Return the exact account name and full address shown by the source. Do not use nearby listings, another location, a chain location, or a general business category. Include only explicitly listed days and hours. Use a 12-hour range such as "9:00 AM–5:00 PM", "Closed", or "Open 24 hours". Do not guess missing days. If the source cannot confirm this exact location and its hours, return exactLocation=false and an empty schedule.\n\n${agencyIdentity}`);
    if (!research) return { error: 'No confirmed public hours were found. You can enter known hours manually.' };
    const { result, sourceUrls } = research;
    const matchedAddress = typeof result.matchedAddress === 'string' ? normalizeIdentity(result.matchedAddress) : '';
    const accountName = normalizeIdentity(agency.name);
    const matchedName = typeof result.matchedName === 'string' ? normalizeIdentity(result.matchedName) : '';
    const matchedAgencyNumber = typeof result.matchedAgencyNumber === 'string' ? result.matchedAgencyNumber.replace(/\D/g, '') : '';
    const sourceUrl = typeof result.sourceUrl === 'string' ? result.sourceUrl : '';
    const parsedSourceUrl = hasVerifiableSource(result, sourceUrls);
    if (!parsedSourceUrl) {
      return { error: 'Search did not return a verifiable source link. Enter the hours manually.' };
    }
    const isOhlqLocation = isOhlqLocationUrl(parsedSourceUrl);
    const addressMatches = matchesAgencyAddress(agency, matchedAddress);
    const agencyNumberMatches = matchedAgencyNumber === agency.agencyId.replace(/\D/g, '');
    const identityMatches = isOhlqLocation
      ? agencyNumberMatches && addressMatches
      : result.exactLocation === true && Boolean(accountName) && matchedName === accountName && addressMatches;
    if (!identityMatches) return { error: 'Search could not confirm this exact agency location. Review or enter its hours manually.' };

    if (!hasUsableSchedule(result)) {
      return { error: 'The source did not provide usable weekly hours. You can enter the hours manually.' };
    }
    const schedule = (result.schedule ?? []).map((entry) => ({ day: entry.day as OperatingHoursDay, hours: entry.hours as string }));

    await prisma.agency.update({ where: { id: agency.id }, data: { businessHours: {
      schedule,
      sourceType: 'public-web-research',
      sourceName: (result.sourceName as string).trim().slice(0, 120),
      sourceUrl,
      researchedAt: new Date().toISOString(),
    } } });
    revalidatePath(`/agencies/${agency.id}`);
    revalidatePath('/alerts');
    revalidatePath('/');
    return { success: 'Public hours found for the exact agency location and saved with their source.' };
  } catch {
    return { error: 'Could not verify public hours right now. Try again or enter the hours manually.' };
  }
}
