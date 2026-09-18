import { getEmailAppBaseUrl } from './email/sendEmail';
import { addDaysToDateInputValue, formatDateInputValue } from './dateTime';
import type { RenderedDigestEmail, TenantWeeklyDigest } from './weeklyDigest';
import type { DigestHighlight } from './weeklyDigestNarrative';

const escape = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
const color = (value: string, fallback: string) => /^#[\da-f]{6}$/i.test(value) ? value : fallback;
const rgb = (hex: string) => [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
const hex = (values: number[]) => `#${values.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
const light = (value: string) => hex(rgb(value).map((part) => part * 0.08 + 255 * 0.92));
const luminance = (value: string) => rgb(value).map((part) => { const s = part / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }).reduce((sum, part, i) => sum + part * [0.2126, 0.7152, 0.0722][i], 0);
const foreground = (background: string) => luminance(background) > 0.179 ? '#142c32' : '#ffffff';
const dark = (value: string): string => luminance(value) <= 0.13 ? value : dark(hex(rgb(value).map((part) => part * 0.8)));
const dateLabel = (day: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
const safeLogo = (value: string | null) => { try { const url = new URL(value ?? ''); return url.protocol === 'https:' ? url.href : null; } catch { return null; } };

export function renderTenantWeeklyDigestEmail(digest: TenantWeeklyDigest, appBaseUrl = getEmailAppBaseUrl({ allowLocalFallback: true })): RenderedDigestEmail {
  const { organization, metrics, sales, narrative } = digest;
  const primary = color(organization.brandPrimaryColor, '#142c32');
  const accent = color(organization.brandAccentColor, '#146b60');
  const ink = '#243c42';
  const secondary = '#53666b';
  const baseUrl = appBaseUrl.replace(/\/+$/, '');
  const worklistUrl = `${baseUrl}/alerts`;
  const start = formatDateInputValue(digest.window.pastStart, digest.window.timeZone);
  const end = addDaysToDateInputValue(formatDateInputValue(digest.window.pastEnd, digest.window.timeZone), -1);
  const range = `${dateLabel(start)} - ${dateLabel(end)}, ${end.slice(0, 4)}`;
  const subject = `${organization.displayName} | ${organization.digestName} weekly brief: ${range}`;
  const logo = safeLogo(organization.logoUrl);
  const evidenceById = new Map(digest.evidence.map((item) => [item.id, item]));
  const salesNote = sales.status === 'no-products' ? 'No configured Ohio items' : sales.status === 'unavailable' ? 'Sales data unavailable'
    : sales.status === 'partial' ? `Partial: ${sales.coveredDays}/${sales.expectedDays} days imported` : `${dateLabel(sales.startDate)} - ${dateLabel(sales.endDate)}`;
  const salesCoverage = sales.status === 'complete' ? `Sales through ${dateLabel(sales.endDate)}. All ${sales.configuredItems} configured Ohio items included, regardless of product or distribution status.`
    : sales.status === 'partial' ? `Sales totals cover ${sales.coveredDays} of ${sales.expectedDays} days; missing dates are not counted as zero. Latest included report: ${dateLabel(sales.throughDate!)}. All configured Ohio items included.`
    : sales.status === 'no-products' ? 'Sales totals are unavailable because this tenant has no configured Ohio item codes.' : 'Sales totals are unavailable because no completed daily imports cover this week.';
  const number = (value: number | null) => value === null ? 'Unavailable' : value.toLocaleString('en-US');
  const tile = (label: string, value: number | null, note: string, large = false, warning = false) => `<td valign="top" style="width:50%;padding:5px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="background:${large ? light(accent) : '#ffffff'};padding:16px 12px;border-radius:5px;">
    <div style="font-size:${value === null ? 20 : 30}px;font-weight:700;line-height:1.2;color:${warning ? '#963f23' : dark(accent)};">${number(value)}</div>
    <div style="font-size:13px;font-weight:700;margin-top:7px;color:${ink};">${escape(label)}</div>
    <div style="font-size:11px;line-height:1.5;margin-top:4px;color:${secondary};">${escape(note)}</div></td></tr></table></td>`;
  const entryHtml = (entry: DigestHighlight) => {
    const links = [...new Map(entry.evidenceIds.flatMap((id) => { const item = evidenceById.get(id); return item?.href && /^\/(agencies|wholesale)\/[a-zA-Z0-9_-]+$/.test(item.href) ? [[item.href, item] as const] : []; })).values()].slice(0, 2);
    return `<h3 style="font-size:19px;line-height:1.3;margin:12px 0 7px;color:${ink};">${escape(entry.title)}</h3>
      <p style="font-size:15px;line-height:1.6;margin:0 0 8px;color:${ink};">${escape(entry.body)}</p>
      ${links.length ? `<p style="margin:0 0 12px;font-size:12px;line-height:1.6;">${links.map((item) => `<a target="_blank" rel="noopener noreferrer" style="color:${dark(accent)};text-decoration:underline;" href="${escape(baseUrl + item.href)}">${escape(item.account)}</a>`).join(' &middot; ')}</p>` : ''}`;
  };
  const section = (label: string, entries: DigestHighlight[], empty: string, warning = false) => `<tr><td class="content" style="padding:12px 32px 10px;">
    <h2 style="font-size:12px;letter-spacing:1.3px;text-transform:uppercase;margin:0;color:${warning ? '#963f23' : dark(accent)};">${escape(label)}</h2>
    ${entries.length ? entries.map(entryHtml).join('') : `<p style="font-size:14px;line-height:1.6;color:${secondary};margin:10px 0;">${escape(empty)}</p>`}</td></tr>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(subject)}</title>
    <style>body{margin:0;padding:0}table{border-collapse:collapse}a{overflow-wrap:anywhere}@media(max-width:520px){.content{padding-left:20px!important;padding-right:20px!important}.metric-pair{display:block!important;width:100%!important}.heading{font-size:32px!important}}</style></head>
    <body style="margin:0;padding:0;background:#eceeea;font-family:Arial,Helvetica,sans-serif;color:${ink};">
    <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escape(narrative.headline)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:20px 0;">
    <table role="presentation" width="680" cellspacing="0" cellpadding="0" style="width:100%;max-width:680px;background:#f5f4ef;table-layout:fixed;">
      <tr><td class="content" style="padding:30px 32px;background:${primary};color:${foreground(primary)};">
        ${logo ? `<img src="${escape(logo)}" alt="${escape(organization.displayName)}" width="132" style="display:block;max-width:132px;max-height:64px;object-fit:contain;margin-bottom:18px;">` : ''}
        <p style="font-size:12px;font-weight:700;letter-spacing:1.4px;margin:0 0 16px;">${escape(organization.appName)} / ${escape(organization.displayName)}</p>
        <h1 class="heading" style="font-size:38px;line-height:1.15;margin:0 0 14px;">The weekly brief</h1>
        <p style="font-size:13px;margin:0 0 18px;">${escape(range)} &middot; ${escape(digest.window.timeZone)}</p>
        <p style="font-size:16px;line-height:1.5;margin:0;">${escape(narrative.headline)}</p>
      </td></tr>
      <tr><td class="content" style="padding:20px 27px 8px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="table-layout:fixed;"><tr>${tile('Retail bottles sold', sales.retailBottles, salesNote, true)}${tile('Wholesale bottles sold', sales.wholesaleBottles, salesNote, true)}</tr></table>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
          <td class="metric-pair" width="50%" valign="top"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="table-layout:fixed;"><tr>${tile('Visits logged', metrics.visitsLogged, 'This week')}${tile('Tasks completed', metrics.completedWork, 'This week')}</tr></table></td>
          <td class="metric-pair" width="50%" valign="top"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="table-layout:fixed;"><tr>${tile('Overdue tasks', metrics.overdue, `${metrics.unassignedOverdue} without an owner`, false, metrics.overdue > 0)}${tile('Upcoming tasks', metrics.upcoming, 'Next 7 days')}</tr></table></td>
        </tr></table>
        <p style="font-size:11px;line-height:1.6;color:${secondary};margin:8px 5px 10px;">${escape(salesCoverage)}</p>
      </td></tr>
      ${section('Wholesale / Big wins', narrative.wins, narrative.mode === 'fallback' ? 'Wholesale wins could not be summarized this time.' : 'No major wholesale win was identified in the available records this week.')}
      ${section('Wholesale / Risks to watch', narrative.risks, narrative.mode === 'fallback' ? 'Wholesale risks could not be summarized this time.' : 'No material wholesale risk was identified in the available records.', true)}
      ${section('Retail / Big wins', narrative.retailWins, narrative.mode === 'fallback' ? 'Retail wins could not be summarized this time.' : 'No major retail win was identified in the available records this week.')}
      ${section('Retail / Risks to watch', narrative.retailRisks, narrative.mode === 'fallback' ? 'Retail risks could not be summarized this time.' : 'No material retail risk was identified in the available records.', true)}
      <tr><td class="content" style="padding:4px 32px 10px;"><p style="font-size:11px;line-height:1.6;color:${secondary};margin:0;">${escape(sales.retail ? `Retail sales recorded at ${sales.retail.sellingAgencies} agencies in the covered dates. ${sales.retail.comparable ? 'Agency comparisons use two complete weeks.' : 'Week-over-week retail comparisons are unavailable because both weeks are not fully covered.'}` : 'Agency-level retail sales insights are unavailable for this period.')}</p></td></tr>
      <tr><td class="content" style="padding:14px 32px 28px;">
      <a target="_blank" rel="noopener noreferrer" href="${escape(worklistUrl)}" style="display:inline-block;background:${accent};color:${foreground(accent)};font-weight:700;font-size:14px;line-height:22px;padding:12px 18px;text-decoration:none;border-radius:4px;">Open team worklist &rarr;</a>
      <p style="font-size:11px;line-height:1.6;color:${secondary};margin:18px 0 0;">${escape(organization.appName)} &middot; ${escape(organization.displayName)}<br>One shared brief for your tenant. Based on recorded activity; customer interest is not a confirmed sale.
      ${narrative.mode === 'fallback' ? '<br>Summary unavailable this time; showing verified activity totals.' : ''}
      ${digest.evidenceLimited ? '<br>Highlights use a limited selection of records. Activity totals include all matching records.' : ''}</p>
      </td></tr></table></td></tr></table></body></html>`;
  const textSection = (label: string, entries: DigestHighlight[], empty: string) => [label, ...(entries.length ? entries.map((item) => `${item.title}\n${item.body}${item.evidenceIds.flatMap((id) => { const source = evidenceById.get(id); return source?.href ? [`\n${source.account}: ${baseUrl}${source.href}`] : []; }).join('')}`) : [empty]), ''].join('\n');
  const text = [subject, narrative.headline, '', `Retail bottles sold: ${number(sales.retailBottles)}`, `Wholesale bottles sold: ${number(sales.wholesaleBottles)}`, salesNote, salesCoverage,
    `Visits logged: ${metrics.visitsLogged}`, `Tasks completed: ${metrics.completedWork}`, `Overdue tasks: ${metrics.overdue} (${metrics.unassignedOverdue} without an owner)`, `Upcoming tasks: ${metrics.upcoming}`, '',
    textSection('WHOLESALE / BIG WINS', narrative.wins, narrative.mode === 'fallback' ? 'Wholesale wins could not be summarized this time.' : 'No major wholesale win identified in the available records.'),
    textSection('WHOLESALE / RISKS TO WATCH', narrative.risks, narrative.mode === 'fallback' ? 'Wholesale risks could not be summarized this time.' : 'No material wholesale risk identified in the available records.'),
    textSection('RETAIL / BIG WINS', narrative.retailWins, narrative.mode === 'fallback' ? 'Retail wins could not be summarized this time.' : 'No major retail win identified in the available records.'),
    textSection('RETAIL / RISKS TO WATCH', narrative.retailRisks, narrative.mode === 'fallback' ? 'Retail risks could not be summarized this time.' : 'No material retail risk identified in the available records.'),
    sales.retail ? `Retail sales recorded at ${sales.retail.sellingAgencies} agencies. ${sales.retail.comparable ? 'Agency comparisons use two complete weeks.' : 'Week-over-week retail comparisons unavailable: both weeks are not fully covered.'}` : 'Agency-level retail sales insights unavailable for this period.',
    `Open team worklist: ${worklistUrl}`, `${organization.appName} / ${organization.displayName}`,
    'Based on recorded activity; customer interest is not a confirmed sale.',
    ...(narrative.mode === 'fallback' ? ['Summary unavailable this time; showing verified activity totals.'] : []),
    ...(digest.evidenceLimited ? ['Highlights use a limited selection of records. Activity totals include all matching records.'] : []),
  ].join('\n');
  return { subject, html, text };
}
