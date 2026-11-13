import type { Prisma } from '@prisma/client';
import { normalize } from './domain';
import { isCurrentSupplyEvidence, readSupplySourceProvenance } from './orderConfirmation';
import {hasSupplyAccess,productionMemberIds,readSupplySettings} from './config';
import {normalizeSupplyLocation} from './statusDomain';
import {canReadSupplyMailbox} from './mailAccess';

/** Withdrawing quoted/artifact evidence hides unsupported legacy operations; it never deletes history. */
export async function quarantineUnsupportedSupplyOrders(tx: Prisma.TransactionClient, organizationId: string, actorUserId: string, sourceId: string, options:{quarantine?:boolean;restore?:boolean}={}) {
  const orders=await tx.supplyOrder.findMany({where:{organizationId,...(!options.restore?{ignored:false}:{}),sources:{some:{sourceId}}},include:{lines:true,sources:{include:{source:true}},shipments:true,receipts:{select:{id:true}}}});
  const bootstrapOwners=[...new Set(orders.flatMap(order=>order.sources.flatMap(link=>link.source.provider==='GOOGLE_CONNECTOR' && link.source.userId?[link.source.userId]:[])))];
  const organization=bootstrapOwners.length?await tx.organization.findUnique({where:{id:organizationId},select:{crmPreferences:true}}):null;
  const managers=bootstrapOwners.length?await tx.user.findMany({where:{organizationId,id:{in:bootstrapOwners},isActive:true},select:{id:true,role:true}}):[];
  const trustedBootstrap=new Set(managers.filter(user=>hasSupplyAccess(user,readSupplySettings(organization?.crmPreferences),true)).map(user=>user.id));
  const connectionIds=[...new Set(orders.flatMap(order=>order.sources.flatMap(link=>link.source.provider==='GOOGLE_CONNECTOR' && link.source.mailboxConnectionId?[link.source.mailboxConnectionId]:[])))];
  const connections=connectionIds.length?await tx.mailboxConnection.findMany({where:{organizationId,id:{in:connectionIds},enabled:true},select:{id:true,userId:true,provider:true,scope:true,enabled:true,accessTokenEncrypted:true}}):[];
  const quarantined:string[]=[];
  for(const order of orders){
    const protectedManual=order.manualFields.length || order.receipts.length || order.lines.some(line=>line.manualClassification || line.manualFields.length);
    const supported=order.sources.some(link=>{
      const source=link.source,facts=source.extractedFacts as {kind?:string;supplier?:string;destination?:string;orderReference?:string;lines?:Array<{sku?:string|null;description?:string;unit?:string|null}>}|null;
      const current=isCurrentSupplyEvidence(readSupplySourceProvenance(facts));
      const bootstrap=source.provider==='GOOGLE_CONNECTOR' && source.userId && (source.mailboxConnectionId?managers.some(user=>user.id===source.userId) && productionMemberIds(organization?.crmPreferences).includes(source.userId) && connections.some(connection=>connection.id===source.mailboxConnectionId && connection.userId===source.userId && canReadSupplyMailbox(connection)):trustedBootstrap.has(source.userId));
      if(source.extractionStatus!=='COMPLETE' || !facts || !['ORDER','SHIPMENT'].includes(facts.kind || '') || !current && !bootstrap)return false;
      if(order.orderReference && facts.orderReference && order.orderReference!==facts.orderReference || normalize(facts.supplier) && normalize(order.supplier)!==normalize(facts.supplier) || normalizeSupplyLocation(order.destination) && normalizeSupplyLocation(facts.destination) && normalizeSupplyLocation(order.destination)!==normalizeSupplyLocation(facts.destination))return false;
      if(order.orderReference && facts.orderReference===order.orderReference)return true;
      return facts.lines?.some(fact=>order.lines.some(line=>(fact.sku && line.sku?normalize(fact.sku)===normalize(line.sku):normalize(fact.description)===normalize(line.description)) && normalize(fact.unit)===normalize(line.unit))) || false;
    });
    if(supported){
      if(options.restore && order.ignored && !order.manualFields.includes('ignored') && await tx.supplyAudit.findFirst({where:{organizationId,orderId:order.id,action:'ORDER_QUARANTINED_UNSUPPORTED_EVIDENCE'},select:{id:true}})){
        await tx.supplyOrder.update({where:{organizationId_id:{organizationId,id:order.id}},data:{ignored:false}});
        await tx.supplyAudit.create({data:{organizationId,actorUserId,orderId:order.id,action:'ORDER_CURRENT_SUPPORT_RESTORED',detail:{sourceId,reason:'Independent current evidence now supports the same exact retained purchase; manual ignore is unchanged.'}}});
      }
      continue;
    }
    if(options.quarantine===false || order.ignored || protectedManual || order.shipments.some(shipment=>shipment.providerMode!=='test' && shipment.lastSuccessfulCheckAt))continue;
    await tx.supplyOrder.update({where:{organizationId_id:{organizationId,id:order.id}},data:{ignored:true,reviewRequired:true}});
    await tx.supplyAudit.create({data:{organizationId,actorUserId,orderId:order.id,action:'ORDER_QUARANTINED_UNSUPPORTED_EVIDENCE',detail:{sourceId,reason:'Current re-extraction no longer supports this legacy-only purchase. Original sources and order history are retained.',automatic:true}}});
    quarantined.push(order.id);
  }
  return quarantined;
}
