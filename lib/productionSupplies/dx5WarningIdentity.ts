export type Dx5WarningSource = {provider:string;subject?:string|null;mailboxConnectionId?:string|null;extractedFacts:unknown};
export type TrustedDx5WarningIdentity = {version:1;label:string;key:string;explicitMaterialId:string|null;inferredLabelFragment:boolean};
const labelKey=(value:string)=>value.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();

/** Literal trusted provider labels are identities, not an invitation to infer chemical/catalog aliases. */
export function trustedDx5WarningIdentity(source:Dx5WarningSource):TrustedDx5WarningIdentity|null {
  const facts=source.extractedFacts as {kind?:unknown;warningSource?:unknown;warning?:{material?:unknown;materialId?:unknown};_provenance?:{contentVersion?:unknown;evidenceContext?:unknown;productionTeamAuthorized?:unknown}}|null;
  if(source.provider!=='GOOGLE' || !source.mailboxConnectionId || facts?.kind!=='WARNING' || facts.warningSource!=='DISTILLX5_EMAIL' || facts._provenance?.contentVersion!=='SUPPLY_CURRENT_V1' || facts._provenance.evidenceContext!=='CURRENT_MESSAGE' || facts._provenance.productionTeamAuthorized!==true)return null;
  const subject=source.subject?.trim() || '';
  if(/[\r\n]/.test(subject))return null;
  const label=/^Inventory Low:\s*(.+)$/i.exec(subject)?.[1]?.trim();
  if(!label || label.length>300)return null;
  const material=typeof facts.warning?.material==='string'?facts.warning.material:'';
  const rawId=typeof facts.warning?.materialId==='string'?facts.warning.materialId.trim():'';
  const suffix=/^(.*?)\s*\(([^()]*)\)\s*$/.exec(label);
  // This is a literal decomposition check, not a formula/abbreviation equivalence.
  const inferredLabelFragment=Boolean(rawId && suffix && (labelKey(material)===labelKey(suffix[1]) || labelKey(material)===labelKey(label)) && labelKey(rawId)===labelKey(suffix[2]));
  const explicitMaterialId=rawId && !inferredLabelFragment?rawId:null;
  return{version:1,label,key:explicitMaterialId?`dx5-id:${explicitMaterialId}`:`dx5-label:${labelKey(label)}`,explicitMaterialId,inferredLabelFragment};
}

export function compatibleDx5WarningIdentity(source:Dx5WarningSource,identity:TrustedDx5WarningIdentity,options:{reviewedCatalog?:boolean}={}){
  const known=trustedDx5WarningIdentity(source);
  if(known){if(known.explicitMaterialId && identity.explicitMaterialId)return known.explicitMaterialId===identity.explicitMaterialId;return options.reviewedCatalog || known.key===identity.key;}
  const rawId=(source.extractedFacts as {warning?:{materialId?:unknown}}|null)?.warning?.materialId;
  return typeof rawId!=='string' || !rawId.trim() || rawId.trim()===identity.explicitMaterialId || Boolean(options.reviewedCatalog && !identity.explicitMaterialId);
}
