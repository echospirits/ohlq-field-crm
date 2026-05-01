export const dynamic='force-dynamic';
export const runtime='nodejs';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '../../lib/prisma';

const toOptional=(v?:string)=>{const t=(v??'').trim();return t||null};

async function createWholesale(formData:FormData){
  'use server';
  const name=String(formData.get('name')??'').trim();
  const licenseeId=String(formData.get('licenseeId')??'').trim();
  if(!name||!licenseeId) redirect('/wholesale?status=invalid');
  await prisma.wholesaleAccount.upsert({where:{licenseeId},create:{licenseeId,name,agencyId:toOptional(String(formData.get('agencyId')??'')),address:toOptional(String(formData.get('address')??'')),city:toOptional(String(formData.get('city')??'')),phone:toOptional(String(formData.get('phone')??'')),ownership:toOptional(String(formData.get('ownership')??''))},update:{name,agencyId:toOptional(String(formData.get('agencyId')??'')),address:toOptional(String(formData.get('address')??'')),city:toOptional(String(formData.get('city')??'')),phone:toOptional(String(formData.get('phone')??'')),ownership:toOptional(String(formData.get('ownership')??''))}});
  revalidatePath('/wholesale');
  redirect('/wholesale?status=saved');
}

export default async function WholesalePage({searchParams}:{searchParams?:Promise<{q?:string;status?:string}>}){const params=(await searchParams)??{};const q=(params.q??'').trim();const accounts=await prisma.wholesaleAccount.findMany({take:300,where:q?{OR:[{name:{contains:q,mode:'insensitive'}},{address:{contains:q,mode:'insensitive'}},{phone:{contains:q,mode:'insensitive'}},{agencyId:{contains:q,mode:'insensitive'}},{licenseeId:{contains:q,mode:'insensitive'}}]}:undefined,orderBy:{name:'asc'}});return<><h1>Wholesale Accounts</h1><p className='muted'>Manual creation only.</p><div className='grid'><div className='card'><h2>Create / update wholesale account</h2><form action={createWholesale}><input name='licenseeId' placeholder='Licensee ID' required/><input name='name' placeholder='Name' required/><input name='agencyId' placeholder='Agency ID'/><input name='address' placeholder='Address'/><input name='city' placeholder='City'/><input name='phone' placeholder='Phone'/><input name='ownership' placeholder='Ownership'/><button type='submit'>Save wholesale account</button></form></div></div><form method='get' style={{maxWidth:520}}><input name='q' defaultValue={q} placeholder='Filter by name, licensee ID, agency ID, address, phone'/></form>{params.status==='saved'?<p className='pill'>Wholesale account saved.</p>:null}{params.status==='invalid'?<p className='pill'>Name and Licensee ID are required.</p>:null}<table><thead><tr><th>Licensee ID</th><th>Name</th><th>Agency ID</th><th>Address</th><th>City</th><th>Phone</th></tr></thead><tbody>{accounts.map(a=><tr key={a.id}><td>{a.licenseeId}</td><td>{a.name}</td><td>{a.agencyId}</td><td>{a.address}</td><td>{a.city}</td><td>{a.phone}</td></tr>)}</tbody></table></>}
