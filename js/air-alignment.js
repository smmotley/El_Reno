import { radarLocalPosition } from './air-surface.js';

const R = 6378137, DEG = Math.PI / 180;
const project = ({lat,lon}) => [R*lon*DEG, R*Math.log(Math.tan(Math.PI/4+lat*DEG/2))];
const unproject = ([x,y]) => ({lat:(2*Math.atan(Math.exp(y/R))-Math.PI/2)/DEG,lon:x/R/DEG});

// A user-requested display fit, not a replacement for archive geolocation.
// Derive both projections from the same geographic feature/target pair.
export function createAirAlignment({source,target},site) {
  const a=project(source),b=project(target);
  const mercatorMeters=b.map((value,i)=>value-a[i]);
  const localA=radarLocalPosition(source.lat,source.lon,site),localB=radarLocalPosition(target.lat,target.lon,site);
  const localKm=localB.map((value,i)=>value-localA[i]);
  const translate=point=>unproject(project(point).map((value,i)=>value+mercatorMeters[i]));
  return {mercatorMeters,localKm,translate};
}

export function radarDisplayBounds(sourceId,bounds,alignment,enabled) {
  if(sourceId!=='air'||!enabled)return bounds;
  return bounds.map(([lat,lon])=>{
    const point=alignment.translate({lat,lon});return [point.lat,point.lon];
  });
}
