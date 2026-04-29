export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import { prisma } from '@/lib/prisma';
export default async function Recipes(){
 const recipes = await prisma.recipe.findMany({take:100,orderBy:{name:'asc'},include:{sku:true}});
 return <><h1>Cocktail Recipes</h1><table><thead><tr><th>Name</th><th>SKU</th><th>Season</th><th>Flavor</th><th>Complexity</th></tr></thead><tbody>{recipes.map(r=><tr key={r.id}><td>{r.name}</td><td>{r.sku?.itemCode ?? ''}</td><td>{r.season}</td><td>{r.flavorProfile}</td><td>{r.complexity}</td></tr>)}</tbody></table></>;
}
