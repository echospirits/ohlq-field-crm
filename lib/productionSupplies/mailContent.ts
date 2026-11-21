export type GmailPart = { partId?: string; mimePath?: string; mimeType?: string; filename?: string; headers?: Array<{ name: string; value: string }>; body?: { data?: string; attachmentId?: string; size?: number }; parts?: GmailPart[] };
export const SUPPLY_CONTENT_VERSION = 'SUPPLY_CURRENT_V1';
export const flattenGmailParts = (part: GmailPart, mimePath='0'): GmailPart[] => [{...part,mimePath}, ...(part.parts ?? []).flatMap((child,index)=>flattenGmailParts(child,`${mimePath}.${index}`))];
const header = (part: GmailPart, name: string) => part.headers?.find(value => value.name.toLowerCase() === name)?.value ?? '';
const decode = (value?: string) => value ? Buffer.from(value, 'base64url').toString('utf8') : '';
type MailHeader = { name: string; value: string };
type AuthenticationClause = { text: string; raw: string };

/** Separate top-level results so arbitrary text inside a comment is never a method result. */
function authenticationClauses(value: string): AuthenticationClause[] {
  const clauses: AuthenticationClause[] = [];
  let text = '', start = 0, depth = 0, quoted = false, escaped = false;
  for (const [index, character] of value.split('').entries()) {
    if (escaped) { if (!depth) text += character; escaped = false; continue; }
    if (character === '\\') { escaped = true; if (!depth) text += character; continue; }
    if (!depth && character === '"') quoted = !quoted;
    if (!quoted && character === '(') { depth++; continue; }
    if (!quoted && character === ')') { if (!depth) return []; depth--; continue; }
    if (depth) continue;
    if (character === ';' && !quoted) {
      clauses.push({ text: text.trim(), raw: value.slice(start, index).trim() });
      start = index + 1;
      text = '';
    } else {
      text += character;
    }
  }
  if (depth || quoted || escaped) return [];
  return [...clauses, { text: text.trim(), raw: value.slice(start).trim() }];
}

function authenticationTags(values: string[]) {
  const tags = new Map<string, string>();
  for (const value of values.filter(Boolean)) {
    const match = /^([a-z][a-z0-9]*)\s*=\s*(\S(?:.*\S)?)$/is.exec(value);
    if (!match || tags.has(match[1].toLowerCase())) return new Map<string, string>();
    tags.set(match[1].toLowerCase(), match[2].toLowerCase());
  }
  return tags;
}

function hasAlignedDkim(clauses: AuthenticationClause[], aligned: (domain: string) => boolean) {
  return clauses.some(({ text }) => /^dkim=pass(?:\s|$)/i.test(text) &&
    aligned(text.match(/(?:^|\s)header\.d=([^\s;]+)/i)?.[1] || text.match(/(?:^|\s)header\.i=[^\s@;]*@([^\s;]+)/i)?.[1] || ''));
}

function hasAlignedDmarc(clauses: AuthenticationClause[], aligned: (domain: string) => boolean) {
  return clauses.some(({ text }) => /^dmarc=pass(?:\s|$)/i.test(text) && aligned(text.match(/(?:^|\s)header\.from=([^\s;]+)/i)?.[1] || ''));
}

function hasValidatedMicrosoftArc(headers: MailHeader[], googleResults: AuthenticationClause[], domain: string) {
  const arc = googleResults.filter(({ text }) => /^arc\s*=/i.test(text));
  if (arc.length !== 1) return false;
  // Interpret only the specific original-sender summary attached to Google's
  // top-level ARC verdict. Comments on other methods cannot authenticate mail.
  const summary = /^arc=pass\s+\(([^()]+)\)$/i.exec(arc[0].raw)?.[1];
  if (!summary) return false;
  const tags = authenticationTags(summary.trim().split(/\s+/));
  if (tags.get('i') !== '1' || tags.get('dkim') !== 'pass' || tags.get('dkdomain') !== domain ||
      tags.get('dmarc') !== 'pass' || tags.get('fromdomain') !== domain) return false;

  // Gmail validates the chain cryptographically. Accept only the observed
  // two-hop chain with Google's receiving seal and Microsoft's signed results.
  const seals = headers.filter(({ name }) => name.toLowerCase() === 'arc-seal')
    .map(({ value }) => authenticationTags(authenticationClauses(value).map(({ text }) => text)));
  const hasSeal = (instance: string, signer: string, status: string) => seals.some(seal =>
    seal.get('i') === instance && seal.get('d') === signer && seal.get('cv') === status && Boolean(seal.get('b')));
  if (seals.length !== 2 || !hasSeal('1', 'microsoft.com', 'none') || !hasSeal('2', 'google.com', 'pass')) return false;
  const originals = headers.filter(({ name }) => name.toLowerCase() === 'arc-authentication-results')
    .map(({ value }) => authenticationClauses(value));
  const byInstance = (instance: string, server: RegExp) => originals.find(results =>
    /^i\s*=\s*([12])$/i.exec(results[0]?.text ?? '')?.[1] === instance && server.test(results[1]?.text ?? ''));
  const microsoft = byInstance('1', /^mx\.microsoft\.com(?:\s+1)?$/i);
  return originals.length === 2 && Boolean(microsoft && byInstance('2', /^mx\.google\.com(?:\s+1)?$/i) &&
    hasAlignedDkim(microsoft.slice(2), signed => signed.toLowerCase() === domain) &&
    hasAlignedDmarc(microsoft.slice(2), signed => signed.toLowerCase() === domain));
}
const entities = (value: string) => value.replace(/&(?:nbsp|amp|lt|gt|quot|apos);|&#(?:x[0-9a-f]+|\d+);/gi, entity => {
  const named: Record<string,string> = { '&nbsp;':' ', '&amp;':'&', '&lt;':'<', '&gt;':'>', '&quot;':'"', '&apos;':"'" };
  if (named[entity.toLowerCase()] !== undefined) return named[entity.toLowerCase()];
  const number = entity[2]?.toLowerCase() === 'x' ? parseInt(entity.slice(3,-1),16) : parseInt(entity.slice(2,-1),10);
  return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : ' ';
});

/** Keep only the current author text. Quoted material is never promoted to a current event. */
export function currentPlainText(value: string) {
  const normalized = value.replace(/\r\n?/g,'\n');
  const boundary = /(?:^|\n)(?:On [^\n]{0,250}(?:\n[^\n]{0,250}){0,3}?wrote:\s*|[-_]{3,}\s*(?:Original Message|Forwarded message)[^\n]*|Begin forwarded message:|From:[^\n]+\n(?:Sent|Date):[^\n]+\n)/im.exec(normalized);
  const current = boundary ? normalized.slice(0,boundary.index) : normalized;
  return current.split('\n').filter(line => !/^\s*>/.test(line)).join('\n').split(/\n-- ?\n/)[0].trim();
}

function htmlContent(html: string) {
  const stack: Array<{ tag: string; hidden: boolean }> = [];
  const cids = new Set<string>(), allCids = new Set<string>();
  let text = '', quotedTail = false;
  for (const token of html.slice(0,500_000).match(/<!--[^]*?-->|<[^>]*>|[^<]+/g) ?? []) {
    if (token.startsWith('<!--')) continue;
    if (!token.startsWith('<')) { if (!quotedTail && !stack.some(item => item.hidden)) text += entities(token); continue; }
    const closing = /^<\s*\//.test(token), tag = token.match(/^<\s*\/?\s*([a-z0-9]+)/i)?.[1]?.toLowerCase();
    if (!tag) continue;
    if (closing) { const index = stack.map(item=>item.tag).lastIndexOf(tag); if (index >= 0) stack.splice(index); if (/^(?:div|p|tr|li|h[1-6])$/.test(tag)) text += '\n'; continue; }
    const hidden = /^(?:script|style|blockquote)$/.test(tag) || /(?:class|id)\s*=\s*["'][^"']*(?:gmail_quote|gmail_signature|yahoo_quoted|moz-cite-prefix|signature)[^"']*["']/i.test(token);
    if (/id\s*=\s*["']divRplyFwdMsg["']/i.test(token)) quotedTail = true;
    if (tag === 'img') { const cid=token.match(/\bsrc\s*=\s*["']cid:([^"']+)["']/i)?.[1]?.toLowerCase(); if(cid){allCids.add(cid);if(!quotedTail&&!hidden&&!stack.some(item=>item.hidden))cids.add(cid);} }
    if (/^(?:br|hr|div|p|tr|li)$/.test(tag)) text += '\n';
    if (!/^(?:img|br|hr|meta|link|input|wbr|area|base|source)$/.test(tag) && !/\/\s*>$/.test(token)) stack.push({tag,hidden});
  }
  return { text: currentPlainText(text).replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n'), currentCids:cids, allCids };
}

export function prepareSupplyMessageContent(payload: GmailPart, subject = '') {
  const parts = flattenGmailParts(payload);
  const html = htmlContent(parts.filter(p=>p.mimeType==='text/html' && !p.filename).map(p=>decode(p.body?.data)).join('\n'));
  const plain = parts.filter(p=>p.mimeType==='text/plain' && !p.filename).map(p=>decode(p.body?.data)).join('\n');
  const text = currentPlainText(plain || html.text).slice(0,100_000);
  const documentCue = /\b(?:invoice|proforma|receipt|packing\s*(?:list|slip)|bill\s+of\s+lading|attached\s+(?:order|document)|scanned\s+(?:order|document))\b/i.test(text+' '+subject);
  let ignoredInlineImages = 0;
  const ignoredImageParts:GmailPart[]=[];
  const attachments = parts.filter(part => {
    if (!part.filename && !(part.body?.attachmentId && (part.mimeType === 'application/pdf' || part.mimeType?.startsWith('image/')))) return false;
    if (!part.mimeType?.startsWith('image/')) return true;
    const name=part.filename || '', disposition=header(part,'content-disposition'), cid=header(part,'content-id').replace(/[<>]/g,'').toLowerCase();
    const embedded=/^inline\b/i.test(disposition) || Boolean(cid);
    const quoteOnly=Boolean(cid && html.allCids.has(cid) && !html.currentCids.has(cid));
    const decorative=/(?:logo|signature|social|facebook|linkedin|instagram|spacer|banner|icon|tracking[-_ ]?pixel)/i.test(name);
    const generic=/^(?:image\d*|outlook-[a-z0-9]+|sig(?:nature)?\d*)\.(?:png|jpe?g|gif|webp)$/i.test(name);
    const documentName=/\b(?:invoice|proforma|receipt|packing|bill[-_ ]?of[-_ ]?lading|scan(?:ned)?[-_ ]?(?:invoice|document))\b/i.test(name.replace(/_/g,' '));
    const currentDocument=documentName && !quoteOnly || documentCue && !decorative && !quoteOnly && (part.body?.size ?? 0) >= 50_000;
    const ignore=decorative || quoteOnly || embedded && !currentDocument || generic && embedded && !currentDocument;
    if (ignore) {ignoredInlineImages++;ignoredImageParts.push(part);}
    return !ignore;
  }).sort((a,b)=>Number(b.mimeType==='application/pdf')-Number(a.mimeType==='application/pdf'));
  return { text, attachments, ignoredInlineImages, ignoredImageParts };
}

/** From is an attestation only with provider SENT ownership or Google's aligned sender result. */
export function supplyMessageSender(headers: MailHeader[], sent: boolean, ownerEmail?: string | null) {
  const from=headers.filter(h=>h.name.toLowerCase()==='from');if(from.length!==1 || from[0].value.includes(','))return {};
  const value=from[0].value.trim(), address=(value.match(/^[^<>]*<([^<>\s]+@[^<>\s]+)>\s*$/)?.[1] || (/^[^<>\s]+@[^<>\s]+$/.test(value)?value:'')).toLowerCase();
  if(!address)return {};
  if(sent)return ownerEmail?.toLowerCase()===address?{fromEmail:address,senderAuthenticated:true as const}:{};
  const [receiver, ...auth] = authenticationClauses(headers.find(h => h.name.toLowerCase() === 'authentication-results')?.value || '');
  if (receiver?.text.toLowerCase() !== 'mx.google.com') return {};
  const domain = address.split('@')[1];
  const aligned = (signed: string) => signed.toLowerCase() === domain || signed.toLowerCase().endsWith('.' + domain);
  const verified = hasAlignedDkim(auth, aligned) || hasAlignedDmarc(auth, aligned) || hasValidatedMicrosoftArc(headers, auth, domain);
  return verified?{fromEmail:address,senderAuthenticated:true as const}:{};
}
