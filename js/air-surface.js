const EARTH_KM = 6371;
const radians = degrees => degrees*Math.PI/180;

// The radar volume uses spherical surface distance, not Web Mercator meters.
export function radarLocalPosition(lat, lon, site) {
  if(![lat,lon,site?.latitude,site?.longitude].every(Number.isFinite))return null;
  const a=radians(lat),b=radians(site.latitude),d=radians(lon-site.longitude);
  const cosine=Math.max(-1,Math.min(1,Math.sin(a)*Math.sin(b)+Math.cos(a)*Math.cos(b)*Math.cos(d)));
  const angle=Math.acos(cosine),scale=angle<1e-10?1:angle/Math.sin(angle);
  return [EARTH_KM*scale*Math.cos(a)*Math.sin(d),EARTH_KM*scale*(Math.cos(b)*Math.sin(a)-Math.sin(b)*Math.cos(a)*Math.cos(d))];
}

export function surfaceHeight(terrain,x,y) {
  if(!terrain||!Number.isFinite(x)||!Number.isFinite(y))return null;
  const [nx,ny]=terrain.dimensions,[x0,x1]=terrain.bounds.x,[y0,y1]=terrain.bounds.y;
  if(x<x0||x>x1||y<y0||y>y1||nx<2||ny<2)return null;
  const u=(x-x0)/(x1-x0)*(nx-1),v=(y-y0)/(y1-y0)*(ny-1);
  const i=Math.min(nx-2,Math.floor(u)),j=Math.min(ny-2,Math.floor(v)),dx=u-i,dy=v-j;
  const h=[terrain.heights[j*nx+i],terrain.heights[j*nx+i+1],terrain.heights[(j+1)*nx+i],terrain.heights[(j+1)*nx+i+1]];
  if(!h.every(Number.isFinite))return null;
  return h[0]*(1-dx)*(1-dy)+h[1]*dx*(1-dy)+h[2]*(1-dx)*dy+h[3]*dx*dy;
}

export function surfacePosition(point,surface) {
  if(!point||!surface)return null;
  const local=radarLocalPosition(point.lat,point.lon,surface.siteLocation);
  if(!local)return null;
  const z=surfaceHeight(surface.terrain,...local);
  return z===null?null:{x:local[0],y:local[1],z};
}

// Display-only simplification (25 m); vehicle motion still uses original roads.
function simplify(points,tolerance=.025) {
  if(points.length<3)return points;
  const keep=new Set([0,points.length-1]),stack=[[0,points.length-1]];
  while(stack.length){
    const [first,last]=stack.pop(),a=points[first],b=points[last],vx=b[0]-a[0],vy=b[1]-a[1],length=vx*vx+vy*vy;
    let farthest=-1,distance=tolerance*tolerance;
    for(let i=first+1;i<last;i++){
      const t=length?Math.max(0,Math.min(1,((points[i][0]-a[0])*vx+(points[i][1]-a[1])*vy)/length)):0;
      const d=(points[i][0]-a[0]-t*vx)**2+(points[i][1]-a[1]-t*vy)**2;
      if(d>distance){distance=d;farthest=i;}
    }
    if(farthest>=0){keep.add(farthest);stack.push([first,farthest],[farthest,last]);}
  }
  return [...keep].sort((a,b)=>a-b).map(i=>points[i]);
}

function clipSegment(a,b,bounds) {
  let lo=0,hi=1;
  const dx=b[0]-a[0],dy=b[1]-a[1];
  for(const [p,q] of [[-dx,a[0]-bounds.x[0]],[dx,bounds.x[1]-a[0]],[-dy,a[1]-bounds.y[0]],[dy,bounds.y[1]-a[1]]]){
    if(p===0){if(q<0)return null;continue;}
    const r=q/p;
    if(p<0)lo=Math.max(lo,r);else hi=Math.min(hi,r);
    if(lo>hi)return null;
  }
  return [[a[0]+lo*dx,a[1]+lo*dy],[a[0]+hi*dx,a[1]+hi*dy]];
}

export function prepareSurface(raw,roads) {
  const surface={...raw,roads:[]};
  const roadTypes=new Set(['motorway','motorway_link','trunk','trunk_link','primary','primary_link','secondary','secondary_link','tertiary','tertiary_link','unclassified','residential','living_street']);
  for(const feature of roads?.features||[]){
    if(feature.geometry?.type!=='LineString'||!roadTypes.has(feature.properties?.highway))continue;
    const source=simplify(feature.geometry.coordinates.map(([lon,lat])=>radarLocalPosition(lat,lon,raw.siteLocation)));
    let run=[];
    const flush=()=>{if(run.length>1)surface.roads.push({points:run,name:feature.properties.name||feature.properties.ref||'',major:/^(motorway|trunk|primary|secondary)/.test(feature.properties.highway)});run=[];};
    for(let i=1;i<source.length;i++){
      const segment=clipSegment(source[i-1],source[i],raw.terrain.bounds);
      if(!segment){flush();continue;}
      const [a,b]=segment,steps=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.5));
      for(let k=0;k<=steps;k++){
        const x=a[0]+(b[0]-a[0])*k/steps,y=a[1]+(b[1]-a[1])*k/steps,z=surfaceHeight(raw.terrain,x,y);
        if(z===null){flush();continue;}
        const previous=run.at(-1);
        if(previous&&(Math.abs(previous[0]-x)+Math.abs(previous[1]-y))<1e-8)continue;
        run.push([x,y,z]);
      }
      if(b[0]!==source[i][0]||b[1]!==source[i][1])flush();
    }
    flush();
  }
  return surface;
}
