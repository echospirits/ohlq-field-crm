import { createHash } from 'node:crypto';
import type { GmailPart } from './mailContent';

export type SupplyAttachmentMetadata={attachmentPartId?:string;attachmentMimePath?:string;attachmentProviderId?:string};
type RetainedAttachment={attachmentKey:string;filename?:string|null;mimeType?:string|null;provider?:string;extractionStatus?:string;extractedFacts?:unknown};
export function supplyAttachmentMetadata(part:GmailPart):SupplyAttachmentMetadata {
  return {...(part.partId?{attachmentPartId:part.partId}:{}),...(part.mimePath?{attachmentMimePath:part.mimePath}:{}),...(part.body?.attachmentId?{attachmentProviderId:part.body.attachmentId}:{})};
}
export function stableSupplyAttachmentKey(part:GmailPart){
  if(part.partId)return 'gmail-part:'+createHash('sha256').update(part.partId).digest('hex');
  if(part.mimePath)return 'gmail-path:'+part.mimePath;
  throw new Error('A stable MIME traversal identity is required for an attachment.');
}
const metadata=(source:RetainedAttachment)=>(source.extractedFacts as {_provenance?:SupplyAttachmentMetadata}|null)?._provenance || {};
const sameName=(part:GmailPart,source:RetainedAttachment)=>Boolean(part.filename)&&part.filename===source.filename&&(part.mimeType || '').toLowerCase()===(source.mimeType || '').toLowerCase();
const hasIdentity=(meta:SupplyAttachmentMetadata)=>Boolean(meta.attachmentPartId || meta.attachmentMimePath);
function matchesIdentity(part:GmailPart,meta:SupplyAttachmentMetadata){return meta.attachmentPartId?meta.attachmentPartId===part.partId:Boolean(meta.attachmentMimePath&&meta.attachmentMimePath===part.mimePath);}
function consistent(part:GmailPart,source:RetainedAttachment){const meta=metadata(source);return !hasIdentity(meta)||matchesIdentity(part,meta);}

/** Caller must bind retained rows to one immutable message and authorized owner. */
export function resolveSupplyAttachment<T extends RetainedAttachment>(part:GmailPart,currentParts:GmailPart[],retained:T[]):{key:string;existing?:T} {
  const key=stableSupplyAttachmentKey(part),documents=retained.filter(source=>Boolean(source.attachmentKey)&&source.attachmentKey!=='__attachment_limit__');
  const stable=documents.filter(source=>source.attachmentKey===key&&consistent(part,source));if(stable.length===1)return{key,existing:stable[0]};
  const identified=documents.filter(source=>hasIdentity(metadata(source))&&matchesIdentity(part,metadata(source)));if(identified.length===1)return{key:identified[0].attachmentKey,existing:identified[0]};
  if(part.body?.attachmentId){const exact=documents.filter(source=>source.attachmentKey===part.body!.attachmentId&&consistent(part,source));if(exact.length===1)return{key:exact[0].attachmentKey,existing:exact[0]};}
  const named=documents.filter(source=>sameName(part,source)&&consistent(part,source));
  if(currentParts.filter(candidate=>sameName(candidate,{filename:part.filename,mimeType:part.mimeType,attachmentKey:''})).length===1&&named.length===1)return{key:named[0].attachmentKey,existing:named[0]};
  return{key};
}

/** All-decorative filename groups may retire old rotating handles without guessing a part mapping. */
export function ignoredSupplyAttachmentCorrections<T extends RetainedAttachment>(ignored:GmailPart[],currentParts:GmailPart[],retained:T[]){
  const result:Array<{source:T;part:GmailPart;identity?:SupplyAttachmentMetadata}>=[];
  for(const source of retained){
    if(source.provider!=='GOOGLE'||!['COMPLETE','ERROR'].includes(source.extractionStatus || '')||!source.attachmentKey)continue;
    const meta=metadata(source);
    if(hasIdentity(meta)){
      const identified=currentParts.filter(part=>matchesIdentity(part,meta));
      if(identified.length===1&&ignored.includes(identified[0]))result.push({source,part:identified[0],identity:supplyAttachmentMetadata(identified[0])});
      continue;
    }
    const exact=currentParts.filter(part=>part.body?.attachmentId===source.attachmentKey);
    if(exact.length){if(exact.length===1&&ignored.includes(exact[0]))result.push({source,part:exact[0],identity:supplyAttachmentMetadata(exact[0])});continue;}
    const group=currentParts.filter(part=>sameName(part,source));
    if(group.length&&group.every(part=>ignored.includes(part)))result.push({source,part:group[0],...(group.length===1?{identity:supplyAttachmentMetadata(group[0])}:{})});
  }
  return result;
}
