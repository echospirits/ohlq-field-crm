export type GmailPart = { partId?: string; mimePath?: string; mimeType?: string; filename?: string; headers?: Array<{ name: string; value: string }>; body?: { data?: string; attachmentId?: string; size?: number }; parts?: GmailPart[] };
export const SUPPLY_CONTENT_VERSION = 'SUPPLY_CURRENT_V1';
export const flattenGmailParts = (part: GmailPart, mimePath='0'): GmailPart[] => [{...part,mimePath}, ...(part.parts ?? []).flatMap((child,index)=>flattenGmailParts(child,`${mimePath}.${index}`))];
const header = (part: GmailPart, name: string) => part.headers?.find(value => value.name.toLowerCase() === name)?.value ?? '';
const decode = (value?: string) => value ? Buffer.from(value, 'base64url').toString('utf8') : '';
function withoutComments(value: string) {
  let result='',depth=0,quoted=false,escaped=false;
  for(const character of value){
    if(escaped){if(!depth)result+=character;escaped=false;continue;}
    if(character==='\\'){escaped=true;if(!depth)result+=character;continue;}
    if(!depth&&character==='"')quoted=!quoted;
    if(!quoted&&character==='('){depth++;continue;}
    if(!quoted&&character===')'){if(!depth)return '';depth--;continue;}
    if(!depth)result+=character;
  }
  return depth||quoted||escaped?'':result;
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
export function supplyMessageSender(headers: Array<{name:string;value:string}>, sent: boolean, ownerEmail?: string | null) {
  const from=headers.filter(h=>h.name.toLowerCase()==='from');if(from.length!==1 || from[0].value.includes(','))return {};
  const value=from[0].value.trim(), address=(value.match(/^[^<>]*<([^<>\s]+@[^<>\s]+)>\s*$/)?.[1] || (/^[^<>\s]+@[^<>\s]+$/.test(value)?value:'')).toLowerCase();
  if(!address)return {};
  if(sent)return ownerEmail?.toLowerCase()===address?{fromEmail:address,senderAuthenticated:true as const}:{};
  // Ignore comments before reading provider properties, so body/sender prose cannot forge a pass.
  const auth=withoutComments(headers.find(h=>h.name.toLowerCase()==='authentication-results')?.value || '');
  if(!/^\s*mx\.google\.com\s*;/i.test(auth))return {};
  const domain=address.split('@')[1], aligned=(signed:string)=>signed.toLowerCase()===domain || signed.toLowerCase().endsWith('.'+domain);
  const verified=auth.split(';').some(clause=>/^\s*dkim=pass\b/i.test(clause) && aligned(clause.match(/header\.d=([^\s;]+)/i)?.[1] || clause.match(/header\.i=[^\s@;]*@([^\s;]+)/i)?.[1] || '')) || auth.split(';').some(clause=>/^\s*dmarc=pass\b/i.test(clause) && aligned(clause.match(/header\.from=([^\s;]+)/i)?.[1] || ''));
  return verified?{fromEmail:address,senderAuthenticated:true as const}:{};
}
