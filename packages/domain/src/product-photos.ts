import sharpRuntime from "sharp";
// Vinext declares its optional "sharp" default as unknown; use the installed Node package types.
const sharp=sharpRuntime as typeof import("../../../node_modules/sharp/dist/index.mjs").default;
import type { Pool, PoolClient } from "pg";

export const MAX_PRODUCT_PHOTOS=7;
export const MAX_PHOTO_BYTES=5*1024*1024;
export async function photoReferenceBytes(bytes: Buffer) {
  if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) throw new Error("Product reference photo is too large or empty");
  return sharp(bytes,{limitInputPixels:40_000_000}).rotate().resize({width:512,height:512,fit:"inside",withoutEnlargement:true}).flatten({background:"#ffffff"}).jpeg({quality:88}).toBuffer();
}
export async function normalizeProductPhoto(bytes:Buffer,mime:string) {
  if (!bytes.length || bytes.length>MAX_PHOTO_BYTES) throw new Error("Each photo must be 5 MB or smaller");
  if (!["image/jpeg","image/png","image/webp"].includes(mime)) throw new Error("Choose a JPG, PNG, or WebP photo");
  try {
    const image=sharp(bytes,{limitInputPixels:40_000_000,failOn:"warning"});
    const metadata=await image.metadata();
    if (!["jpeg","png","webp"].includes(metadata.format??"") || (metadata.pages??1)>1) throw new Error("Unsupported image");
    // Decode, orient, strip metadata, and bound storage/bandwidth without cropping.
    return await image.rotate().resize({width:2048,height:2048,fit:"inside",withoutEnlargement:true}).flatten({background:"#ffffff"}).jpeg({quality:88}).toBuffer();
  } catch { throw new Error("This photo could not be read. Use a valid, non-animated JPG, PNG, or WebP image under 40 megapixels."); }
}
export async function selectedProductPhoto(client:Pick<Pool|PoolClient,"query">,brandId:string,photoId:string,knowledgeIds:string[]) {
  const result=await client.query<{id:string;asset_id:string;knowledge_id:string;storage_path:string}>("select p.id,p.asset_id,p.knowledge_id,a.storage_path from knowledge_photos p join knowledge_items k on k.id=p.knowledge_id join assets a on a.id=p.asset_id where p.id=$1 and k.brand_id=$2 and k.status='approved' and k.id=any($3::uuid[]) and a.brand_id=$2 and a.status<>'archived' for share of p",[photoId,brandId,knowledgeIds]);
  if(!result.rows[0])throw new Error("Choose a product photo from your selected approved knowledge");
  return result.rows[0];
}
