import test from 'node:test';
import assert from 'node:assert/strict';
import { AirVolumeViewer } from '../js/air-volume-viewer.js';

const near = (actual,expected) => assert.ok(Math.abs(actual-expected)<1e-9, `${actual} ≈ ${expected}`);
const sameVector = (actual,expected) => actual.forEach((v,i)=>near(v,expected[i]));
const freeze = object => { for(const value of Object.values(object))if(value&&typeof value==='object')freeze(value);return Object.freeze(object); };

function viewer() {
  const grid=freeze({min:[-45,0,0],max:[23,45,16],dimensions:[192,160,96],decode:{scale:.5,offset:-32,indexOffset:1}});
  const terrain=freeze({dimensions:[2,2],bounds:{x:[-45,23],y:[0,45]},heights:[.3,.4,.5,.6],sampling:'nodes'});
  const roads=freeze([{points:[[-20,10,.4],[-15,15,.42]],name:'Fixed road'}]);
  const markers=freeze([{id:'suv',x:-20,y:15,z:.4,label:'Our SUV',kind:'suv'}]);
  const raw=new Uint8Array([1,2,0,255]),frame=freeze({time:'2013-05-31T23:12:00.000Z',sourceVolumeNumber:1});
  const uniforms=new Map(),calls=[];
  const gl=new Proxy({uniform3fv:(name,value)=>uniforms.set(name,[...value])},{get:(object,name)=>name in object?object[name]:(...args)=>calls.push([name,...args])});
  const v=Object.assign(Object.create(AirVolumeViewer.prototype),{
    canvas:{width:1280,height:800},_width:1280,_height:800,yaw:0,pitch:.4,zoom:1,_pan:[0,0,0],_radarOffset:[0,0],
    _grid:grid,_terrain:terrain,_roads:roads,_markers:markers,_cache:new Map([['source',raw]]),_desired:{frame},_ready:true,
    _key:'original-source-key',_lastViewState:null,_schedule(){},_drawTerrain(){return true;},_drawLabels(camera){this.lastLabelsCamera=camera;},
    supported:true,active:true,gl,_uniforms:new Proxy({},{get:(_,name)=>name}),opacity:.72,threshold:30
  });
  return {v,grid,terrain,roads,markers,raw,frame,uniforms,calls};
}

test('radar translation changes actual draw bounds while the camera and fixed ground stay put',()=>{
  const {v,grid,terrain,roads,markers,raw,frame,uniforms,calls}=viewer();
  const original=v._camera();v._draw();const originalCellSize=uniforms.get('cellSize');
  assert.equal(v.setRadarOffset([6,-4]),true);v._draw();
  assert.deepEqual(uniforms.get('boxMin'),[-39,-4,0]);assert.deepEqual(uniforms.get('boxMax'),[29,41,16]);
  sameVector(uniforms.get('cellSize'),originalCellSize);
  sameVector(v._camera().eye,original.eye);sameVector(v._camera().center,original.center);
  assert.strictEqual(v._grid,grid);assert.deepEqual(grid.min,[-45,0,0]);
  assert.strictEqual(v._terrain,terrain);assert.strictEqual(v._roads,roads);assert.strictEqual(v._markers,markers);
  assert.strictEqual(v._cache.get('source'),raw);assert.strictEqual(v._desired.frame,frame);
  assert.equal(v._key,'original-source-key');assert.equal(v._ready,true);
  assert.ok(!calls.some(([name])=>name==='texImage3D'),'alignment must not upload, resample or replace source values');
  assert.deepEqual(v.lastLabelsCamera.grid.min,[-39,-4,0],'extent labels use the translated support box');
});

test('the same measured voxel retains its normalized texture coordinate after translation',()=>{
  const {v,uniforms}=viewer();v._draw();
  const oldMin=uniforms.get('boxMin'),oldMax=uniforms.get('boxMax');
  const sourcePoint=[-18.25,22.5,4.125];
  const expected=sourcePoint.map((p,i)=>(p-oldMin[i])/(oldMax[i]-oldMin[i]));
  v.setRadarOffset([4.3,1.8]);v._draw();
  const shiftedPoint=[sourcePoint[0]+4.3,sourcePoint[1]+1.8,sourcePoint[2]];
  const actual=shiftedPoint.map((p,i)=>(p-uniforms.get('boxMin')[i])/(uniforms.get('boxMax')[i]-uniforms.get('boxMin')[i]));
  sameVector(actual,expected);
  assert.deepEqual([uniforms.get('boxMin')[2],uniforms.get('boxMax')[2]],[0,16]);
});

test('toggle preserves SUV focus and reset frames the adjusted volume',()=>{
  const {v,markers}=viewer();
  assert.equal(v.focusMarker('suv'),true);const original=v._camera();
  sameVector(original.center,[-20,15,.4]);
  v.setRadarOffset([6,-4]);sameVector(v._camera().eye,original.eye);sameVector(v._camera().center,original.center);
  assert.equal(v.focusMarker('suv'),true);sameVector(v._camera().center,[-20,15,.4]);
  v.resetView();sameVector(v._camera().center,[-5,18.5,8]);
  assert.strictEqual(v._markers,markers);near(v._terrainHeightAt(-20,15),.3+(.1*25/68)+(.2*15/45));
});

test('zero restores exact recorded bounds without accumulation or caller mutation',()=>{
  const {v,grid}=viewer(),original=v._camera(),offset=[3.125,-1.75];
  v.setRadarOffset(offset);offset[0]=1000;
  assert.deepEqual(v._camera().grid.min,[-41.875,-1.75,0]);
  for(let i=0;i<20;i++){v.setRadarOffset([0,0]);v.setRadarOffset([3.125,-1.75]);}
  assert.equal(v.setRadarOffset([0,0]),true);assert.strictEqual(v._camera().grid,grid);
  sameVector(v._camera().eye,original.eye);sameVector(v._camera().center,original.center);
  assert.equal(v.setRadarOffset([0,0]),false);
  for(const invalid of [null,[],[1],[1,2,3],[NaN,0],[0,Infinity],['1',0]])assert.throws(()=>v.setRadarOffset(invalid),TypeError);
  assert.strictEqual(v._camera().grid,grid);
});
