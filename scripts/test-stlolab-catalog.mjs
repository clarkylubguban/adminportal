import assert from 'node:assert/strict';
import test from 'node:test';
import { contentFromDraft, stlolabDraftFields } from '../src/shared/stlolabContent.js';
import { publicProduct, publicHero, readStlolabCatalog, STAGING_REF } from '../api/_lib/stlolabCatalog.js';
import { createCatalogHandler } from '../api/stlolab-catalog.js';

const row={id:'product-1',product_code:'PIECE-001',name:'Test piece',description:'Public description',product_type:'PHYSICAL',active:true,sellable:true,readiness_status:'READY_FOR_SALE',archived_at:null,eligible_channels:['STLOLAB'],typed_config:{material:'Cotton',production_notes:'PRIVATE',stlolab:{care:'Cold wash'}}};
const variant={id:'variant-1',product_id:row.id,size:'M',color:'Black',selling_price:'1100.55',unit_cost:123,active:true};
const image={id:'image-1',product_id:row.id,public_url:'https://example.com/front.jpg',position:0,is_primary:true,active:true,storage_path:'PRIVATE'};
test('only published STLOLAB physical products cross the public boundary',()=>{
  for(const override of [{active:false},{sellable:false},{archived_at:'2026-01-01'},{eligible_channels:['POS']},{product_type:'SERVICE'},{readiness_status:'NEEDS_SETUP'}]) assert.equal(publicProduct({...row,...override},[variant],[image]),null);
  const result=publicProduct(row,[variant],[image]);
  assert.equal(result.variants[0].priceMinor,110055);assert.equal(result.variants[0].availability,'unknown');
  assert.equal(JSON.stringify(result).includes('PRIVATE'),false);assert.equal('unit_cost' in result.variants[0],false);assert.equal('typed_config' in result,false);
});
test('archived images, bad prices and inactive variants cannot appear',()=>{
  assert.equal(publicProduct(row,[{...variant,selling_price:null}],[image]),null);
  assert.equal(publicProduct(row,[{...variant,active:false}],[image]),null);
  assert.equal(publicProduct(row,[variant],[{...image,archived_at:'2026-01-01'}]),null);
  assert.equal(publicProduct(row,[variant],[{...image,public_url:'javascript:alert(1)'}]),null);
});
test('gallery ordering is independent from primary choice',()=>{
  const result=publicProduct(row,[variant],[{...image,id:'back',position:0,is_primary:false},{...image,id:'front',position:1}]);
  assert.deepEqual(result.media.map(m=>m.key),['back','front']);assert.equal(result.primaryMediaKey,'front');
});
test('garment charts require complete measurements before confirmation',()=>{
  const draft={...stlolabDraftFields(),availableSizes:['M'],stloGarment:'shorts',stloMeasurements:{M:[32,45,55,48]},stloGuideVerified:true};
  assert.equal(contentFromDraft(draft).guide.columns.length,4);
  assert.throws(()=>contentFromDraft({...draft,stloMeasurements:{M:[32]}}),/Complete/);
  assert.throws(()=>contentFromDraft({...draft,stloMeasurements:{M:[-2,45,55,48]}}),/Measurements/);
});
test('guide revisions survive JSONB key reordering and advance on change',()=>{
  const first=contentFromDraft({...stlolabDraftFields(),availableSizes:['M'],stloGarment:'hoodie',stloMeasurements:{M:[58,70,62]},stloGuideVerified:true});
  const reordered={...first,guide:Object.fromEntries(Object.entries(first.guide).reverse())};
  const draft={...stlolabDraftFields(reordered),availableSizes:['M']};
  assert.equal(contentFromDraft(draft).guide.revision,1);
  assert.equal(contentFromDraft({...draft,stloMeasurements:{M:[59,70,62]}}).guide.revision,2);
});
test('unconfirmed chart values and missing variant sizes stay unavailable',()=>{
  const content=contentFromDraft({...stlolabDraftFields(),availableSizes:['M'],stloGarment:'hoodie',stloMeasurements:{M:[58,70,62]},stloGuideVerified:false});
  const result=publicProduct({...row,typed_config:{stlolab:content}},[variant],[image]);
  assert.deepEqual(result.sizeGuide.rows[0].cm,[null,null,null]);
  content.guide.verified=true;
  assert.equal(publicProduct({...row,typed_config:{stlolab:content}},[{...variant,size:'XL'}],[image]).sizeGuide.verified,false);
});
test('hero fields are separate, safe, featured-only and tied to the product',()=>{
  const draft={...stlolabDraftFields(),stloHeroImage:'https://example.com/hero.jpg',stloHeroTitle:'AFTER\nDARK',stloHeroButton:'VIEW PIECE'};
  const content=contentFromDraft(draft);const product=publicProduct(row,[variant],[image]);
  const heroRow={...row,typed_config:{stlolab:content,is_featured:true}};
  assert.equal(publicHero(heroRow,product).href,'/product/PIECE-001');
  assert.equal(publicHero({...heroRow,typed_config:{stlolab:content}},product),null);
  assert.throws(()=>contentFromDraft({...draft,stloHeroMobile:'120% 0%'}),/crop/);
});
function client(data={products:[row],product_variants:[variant],product_images:[image]}, fail=false) {
  return {from(table){const q={};for(const method of ['select','eq','is','contains','order','range','in','limit'])q[method]=()=>q;q.then=(resolve)=>Promise.resolve({data:data[table]||[],error:fail?{message:'PRIVATE SQL'}:null}).then(resolve);return q;}};
}
test('catalog reader projects rows and keeps empty collections empty',async()=>{
  const result=await readStlolabCatalog(client());assert.equal(result.products.length,1);assert.equal(result.nextOffset,null);
  assert.deepEqual(await readStlolabCatalog(client({})),{products:[],hero:null,nextOffset:null});
});
async function request(env,method='GET',url='/api/stlolab-catalog',db=client()){
  let calls=0;const response={headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=JSON.parse(body);}};
  await createCatalogHandler({env,createClient:()=>{calls++;return db;}})({method,url},response);return {...response,calls};
}
const env={STLO_CATALOG_ENABLED:'true',STLO_CATALOG_ENV:'staging',SUPABASE_URL:`https://${STAGING_REF}.supabase.co`};
test('disabled, production and write requests fail before any database call',async()=>{
  for(const settings of [{},{...env,STLO_CATALOG_ENV:'production'},{...env,SUPABASE_URL:'https://wcgtwfctpnwgpglywvvx.supabase.co'}]){const r=await request(settings);assert.equal(r.statusCode,503);assert.equal(r.calls,0);}
  const write=await request(env,'POST');assert.equal(write.statusCode,405);assert.equal(write.calls,0);
});
test('API validates input and never returns database errors or private rows',async()=>{
  const invalid=await request(env,'GET','/api/stlolab-catalog?offset=-1');assert.equal(invalid.statusCode,400);assert.equal(invalid.calls,0);
  const ok=await request(env);assert.equal(ok.statusCode,200);assert.equal(ok.body.environment,'staging');assert.equal(ok.headers['Cache-Control'],'no-store');
  const bad=await request(env,'GET','/api/stlolab-catalog',client({},true));assert.equal(bad.statusCode,503);assert.equal(JSON.stringify(bad.body).includes('PRIVATE'),false);
});
