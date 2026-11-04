import test from 'node:test';
import assert from 'node:assert/strict';
import { radarLocalPosition, surfaceHeight, surfacePosition, prepareSurface } from '../js/air-surface.js';

const terrain={dimensions:[2,2],bounds:{x:[-2,2],y:[0,4]},heights:[.3,.4,.5,.6],sampling:'nodes'};
const surface={siteLocation:{latitude:0,longitude:0},terrain};
const near=(actual,expected,tolerance=1e-8)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} differs from ${expected}`);

test('surface projection preserves true compass directions and spherical kilometer distance',()=>{
  const site=surface.siteLocation;
  assert.deepEqual(radarLocalPosition(0,0,site),[0,0]);
  const north=radarLocalPosition(1,0,site),east=radarLocalPosition(0,1,site),west=radarLocalPosition(0,-1,site);
  near(north[0],0);near(north[1],111.19492664455873);
  near(east[0],111.19492664455873);near(east[1],0);
  near(west[0],-east[0]);
  assert.equal(radarLocalPosition(NaN,0,site),null);
});

test('node-based terrain interpolation preserves edges, slope and kilometer heights',()=>{
  near(surfaceHeight(terrain,-2,0),.3);near(surfaceHeight(terrain,2,4),.6);
  near(surfaceHeight(terrain,0,2),.45);near(surfaceHeight(terrain,0,0),.35);
  assert.equal(surfaceHeight(terrain,2.01,2),null);
  assert.equal(surfaceHeight(terrain,0,-.01),null);
  assert.equal(surfaceHeight({...terrain,heights:[.3,null,.5,.6]},0,2),null);
});

test('unsupported positions and missing terrain never become ground markers',()=>{
  assert.equal(surfacePosition(null,surface),null);
  assert.equal(surfacePosition({lat:1,lon:0},surface),null);
  assert.equal(surfacePosition({lat:0,lon:0},{...surface,terrain:{...terrain,heights:[null,null,null,null]}}),null);
  const point=surfacePosition({lat:0,lon:0,altitude:9000},surface);
  near(point.x,0);near(point.y,0);near(point.z,.35);
});

test('display roads are clipped to real terrain and follow its heights without changing input',()=>{
  const roads={features:[{properties:{highway:'primary',name:'Test road'},geometry:{type:'LineString',coordinates:[[-.03,.01],[0,.02],[.03,.01]]}}]};
  const before=JSON.stringify(roads),result=prepareSurface(surface,roads);
  assert.ok(result.roads.length>0);
  for(const road of result.roads){
    assert.equal(road.major,true);
    for(const [x,y,z] of road.points){
      assert.ok(x>=-2&&x<=2&&y>=0&&y<=4);
      near(z,surfaceHeight(terrain,x,y));
    }
    assert.ok(road.points.some(p=>p[1]>2),'The road turn must be retained.');
  }
  assert.equal(JSON.stringify(roads),before);
});
