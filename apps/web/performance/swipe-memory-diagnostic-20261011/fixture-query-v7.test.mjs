import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fixtureQuery} from './fixture-query-v7.mjs';
const rows=[{id:'a',name:'첫 식당',approved_name:'첫 식당',lat:37.5,lng:127,categories:['한식'],status:'approved',youtube_meta:null},{id:'b',name:'둘,째 식당',approved_name:'둘,째 식당',lat:38,lng:127,categories:['분식'],status:'approved',youtube_meta:null}];
const query=input=>fixtureQuery(rows,new URLSearchParams(input));
test('compact SELECT projection and alias',()=>{const result=query('select=id,name:approved_name,lat,lng');assert.deepEqual(result.data[0],{id:'a',name:'첫 식당',lat:37.5,lng:127});assert.equal(Object.hasOwn(result.data[0],'youtube_meta'),false);assert.equal(result.total,2);});
test('quoted name IN including comma',()=>{assert.deepEqual(fixtureQuery(rows,new URLSearchParams({approved_name:'in.("둘,째 식당")',select:'id,name:approved_name'})).data,[{id:'b',name:'둘,째 식당'}]);});
test('search and viewport subsets',()=>{assert.deepEqual(query('approved_name=ilike.%첫%').data.map(row=>row.id),['a']);assert.deepEqual(query('lat=gte.37&lat=lte.37.6&id=in.(a,b)').data.map(row=>row.id),['a']);});
test('array overlap versus contains',()=>{assert.equal(query('categories=ov.{한식,분식}').data.length,2);assert.equal(query('categories=cs.{한식,분식}').data.length,0);});
test('pagination and total',()=>{assert.deepEqual(query('order=id.desc&offset=1&limit=1&select=id'),{data:[{id:'a'}],total:2});});
test('unsupported predicate is explicit',()=>{assert.throws(()=>query('lat=unexpected.1'),/fixture_predicate_unsupported/);});

test('nullable coordinate predicates match SQL null semantics',()=>{const input=[...rows,{...rows[0],id:'null',lat:null}];assert.equal(fixtureQuery(input,new URLSearchParams('lat=not.is.null')).data.length,2);assert.equal(fixtureQuery(input,new URLSearchParams('lat=is.null')).data.length,1);});

test('popular weekly counts sort numerically',()=>{const input=[{...rows[0],weekly_search_count:9},{...rows[1],weekly_search_count:10}];assert.equal(fixtureQuery(input,new URLSearchParams('order=weekly_search_count.desc')).data[0].id,'b');});

test('positive weekly-count eligibility excludes null and zero',()=>{const input=[{...rows[0],weekly_search_count:0},{...rows[1],weekly_search_count:1},{...rows[0],id:'null',weekly_search_count:null}];assert.deepEqual(fixtureQuery(input,new URLSearchParams('weekly_search_count=gt.0')).data.map(row=>row.id),['b']);});

test('alias and address lookups honor every predicate instead of returning a full catalog',()=>{
  for(const field of ['origin_name','naver_name','google_name','road_address','jibun_address']) {
    const input=[{...rows[0],[field]:'target'},{...rows[1],[field]:'different'}, {...rows[0],id:'null',[field]:null}];
    assert.deepEqual(fixtureQuery(input,new URLSearchParams({[field]:'eq.target',select:'id'})),{data:[{id:'a'}],total:1});
    assert.deepEqual(fixtureQuery(rows,new URLSearchParams({[field]:'eq.target'})),{data:[],total:0});
  }
});
test('SQL NULL cannot equal the string null or match IN and ILIKE',()=>{
  const input=[{...rows[0],origin_name:null},{...rows[1],origin_name:'null'}];
  for(const predicate of ['eq.null','in.(null)','ilike.%']) {
    assert.deepEqual(fixtureQuery(input,new URLSearchParams({origin_name:predicate,select:'id'})).data,[{id:'b'}]);
  }
});
test('unknown filters, projection columns and duplicate controls fail closed',()=>{
  for(const input of ['typo_name=eq.x','and=(id.eq.a)','select=not_a_column','select=id&select=name']) {
    assert.throws(()=>query(input),/fixture_(column|select|control)_unsupported/);
  }
});
test('combined name and address filters preserve an empty result and row identity',()=>{
  const input=[{...rows[0],origin_name:'same',road_address:'one'},{...rows[1],origin_name:'same',road_address:'two'}];
  assert.deepEqual(fixtureQuery(input,new URLSearchParams({origin_name:'eq.same',road_address:'eq.two',select:'id,name:approved_name'})).data,[{id:'b',name:'둘,째 식당'}]);
  assert.equal(fixtureQuery(input,new URLSearchParams({origin_name:'eq.same',road_address:'eq.missing'})).total,0);
});
test('actual published-date order preserves direction and explicit SQL null placement',()=>{
  const input=[{...rows[0],youtube_meta:null},{...rows[1],youtube_meta:{publishedAt:'2025-01-01'}},{...rows[1],id:'c',youtube_meta:{publishedAt:'2026-01-01'}}];
  assert.deepEqual(fixtureQuery(input,new URLSearchParams('order=youtube_meta->>publishedAt.desc.nullslast&select=id')).data.map(r=>r.id),['c','b','a']);
  assert.deepEqual(fixtureQuery(input,new URLSearchParams('order=youtube_meta->>publishedAt.asc.nullsfirst&select=id')).data.map(r=>r.id),['a','b','c']);
  assert.throws(()=>fixtureQuery(input,new URLSearchParams('order=youtube_meta->>unknown.desc.nullslast')),/fixture_order_unsupported/);
});
