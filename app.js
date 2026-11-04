import { MI, normalizePoints, haversine, positionAt, splitTrack, closestApproach, radarFrameAt, validateSpotterImport } from './js/analysis.js';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeURL = value => { try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } };
const link = (url, label) => safeURL(url) ? '<a href="' + esc(safeURL(url)) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + ' ↗</a>' : '';
const date = value => Date.parse(value);
const STORM_START = date('2013-05-31T22:45:00Z'), STORM_END = date('2013-06-01T00:15:00Z');
const state = {
  t: date('2013-05-31T23:10:16Z'), start: STORM_START, end: STORM_END,
  offset: 0, zone: 'America/Chicago', playing: false, speed: 30, compare: false,
  follow: false, basemap: 'dark', range: 'storm', selectedSpotter: null,
  visible: { reflectivity: true, velocity: false, track: true, swath: true, center: true, spotters: true },
  opacity: { reflectivity: .72, velocity: .78, track: 1, swath: .7, center: 1, spotters: 1 }
};
let data, track = [], centers = [], spotters = [], best, maps = [], syncLock = false, toastTimer;
let animationId, lastFrame = 0, lastDraw = 0;
const colors = ['#9bbfc5','#c3b5d5','#b7cfa5','#c4ac8e','#a4b1d1','#c99fb3'];
const SUV = '<svg viewBox="0 0 30 52" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><ellipse cx="15" cy="28" rx="13" ry="23" fill="#0c140f" opacity=".35"/><rect x="3" y="9" width="5" height="10" rx="2" fill="#151b18"/><rect x="22" y="9" width="5" height="10" rx="2" fill="#151b18"/><rect x="3" y="34" width="5" height="10" rx="2" fill="#151b18"/><rect x="22" y="34" width="5" height="10" rx="2" fill="#151b18"/><rect x="5" y="3" width="20" height="45" rx="6" fill="#a4ada9" stroke="#e2e6e1" stroke-width="1.1"/><path d="M8 13L22 13L21 21H9Z" fill="#334a4b"/><rect x="9" y="23" width="12" height="12" rx="2" fill="#87928e"/><path d="M9 37H21L22 42H8Z" fill="#354a47"/><path d="M7 8H11M19 8H23" stroke="#f5ebc5" stroke-width="2.5"/><path d="M7 45H11M19 45H23" stroke="#953f33" stroke-width="2"/><path d="M8 24V34M22 24V34" stroke="#d9dfd8"/></svg>';
$('vehicle-thumbnail').innerHTML = SUV;

function fmt(t, seconds = true) {
  return new Intl.DateTimeFormat('en-US', { timeZone: state.zone, hour: 'numeric', minute: '2-digit', ...(seconds ? {second: '2-digit'} : {}), hour12: state.zone !== 'UTC' }).format(t);
}
function zoneLabel() { return state.zone === 'UTC' ? 'UTC' : 'CDT'; }
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 5000); }
async function loadJSON(url) { const res = await fetch(url); if (!res.ok) throw new Error('Could not load ' + url); return res.json(); }
function latlng(p) { return [p.lat, p.lon]; }
function setPresent(map, layer, shown) { if (shown && !map.hasLayer(layer)) layer.addTo(map); else if (!shown && map.hasLayer(layer)) map.removeLayer(layer); }
function bearing(a, b) { return Math.atan2((b.lon-a.lon)*Math.cos(a.lat*Math.PI/180), b.lat-a.lat)*180/Math.PI; }
function vehicleIcon(white = false) {
  return L.divIcon({ className: 'vehicle-icon', html: '<div class="vehicle-body">' + (white ? SUV.replace('#a4ada9','#f4f4ed').replace('#87928e','#d7ddd6') : SUV) + '</div>', iconSize: [24,42], iconAnchor: [12,21], popupAnchor: [0,-22] });
}
function sourcePopup(name, detail, url, label = 'Source') { return '<strong>' + esc(name) + '</strong><small>' + esc(detail) + '</small>' + link(url,label); }

function makeMap(id, isSecond = false) {
  const map = L.map(id, {zoomControl:false, preferCanvas:true, minZoom:5, maxZoom:17, zoomAnimation:false, fadeAnimation:false}).setView([35.455,-97.985], 11);
  map.attributionControl.setPrefix(false);
  L.control.zoom({position:'topright'}).addTo(map);
  if (!isSecond) L.control.scale({position:'bottomleft',imperial:true,metric:false,maxWidth:100}).addTo(map);
  for (const [name,z] of [['radar',250],['survey',410],['tracks',420],['separation',425]]) {
    map.createPane(name); map.getPane(name).style.zIndex = z;
  }
  const m = {map, base:null, labels:null, overlays:{}, radarFiles:{}, radarFailed:{}, people:new Map()};
  m.swath = L.geoJSON(data.tornado, {
    filter: f => f.properties.kind === 'surveyed-swath',
    pane:'survey', style: {color:'#d3bfa7',weight:1.3,dashArray:'5 5',fillColor:'#ccb695',fillOpacity:.10,opacity:.7},
    onEachFeature: (f,l) => l.bindPopup(sourcePopup('NWS surveyed tornado path','Accumulated footprint of the event. Not the instantaneous tornado edge.',data.timeline.sourceUrl))
  });
  m.centerPath = L.geoJSON(data.tornado, {filter:f=>f.properties.kind==='center-path',pane:'survey',style:{color:'#d3bfa7',weight:1,dashArray:'2 7',opacity:.45}});
  m.route = L.polyline([], {pane:'tracks',color:'#e0c195',weight:3,opacity:1,lineCap:'round'});
  m.routeShadow = L.polyline([], {pane:'tracks',color:'#132119',weight:6,opacity:.75});
  m.fullRoute = L.polyline(splitTrack(track).map(s=>s.map(latlng)), {pane:'tracks',color:'#d7c29c',weight:1.2,opacity:.22,dashArray:'3 6'});
  m.car = L.marker([0,0],{icon:vehicleIcon(),zIndexOffset:500,title:'Shane Motley / smotley',alt:'Grey SUV — our chase'}).bindTooltip('OUR SUV',{permanent:true,direction:'right',offset:[12,0],className:'marker-label'}).bindPopup('');
  m.center = L.marker([0,0],{icon:L.divIcon({className:'tornado-marker',html:'⌁',iconSize:[28,28],iconAnchor:[14,14]}),zIndexOffset:400,title:'NWS estimated tornado center',alt:'Estimated tornado center'}).bindTooltip('NWS CENTER',{direction:'right',offset:[15,0],className:'marker-label'}).bindPopup('');
  m.separation = L.polyline([], {pane:'separation',color:'#e7cfaa',weight:1,dashArray:'3 6',opacity:.7,interactive:false});
  m.selectedTrail = L.polyline([], {pane:'tracks',color:'#a9d3d5',weight:2,opacity:.65});
  m.videoMarkers = L.layerGroup();
  for (const v of data.videos.videos) if (v.time && Number.isFinite(v.lat) && Number.isFinite(v.lon)) {
    const marker = L.circleMarker([v.lat,v.lon],{radius:6,color:'#f1dfbc',fillColor:'#b49564',fillOpacity:1});
    marker.bindPopup('<strong>'+esc(v.title)+'</strong><small>'+esc(fmt(date(v.time)))+'</small>'+link(v.url,'Watch original'));
    m.videoMarkers.addLayer(marker);
  }
  m.videoMarkers.addTo(map);
  map.on('move', () => {
    if (!state.compare || syncLock) return;
    syncLock = true;
    for (const other of maps) if (other.map !== map) other.map.setView(map.getCenter(),map.getZoom(),{animate:false});
    syncLock = false;
  });
  map.on('dragstart',()=>{state.follow=false;$('follow').setAttribute('aria-pressed','false');});
  return m;
}
function setBasemap() {
  const definitions = {
    dark: {url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Present-day context'},
    light: {url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Present-day context'},
    satellite: {url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',attribution:'Imagery © Esri, Maxar, Earthstar Geographics · Present-day context'}
  };
  const def = definitions[state.basemap];
  for (const m of maps) {
    if (m.base) m.base.remove(); if (m.labels) m.labels.remove();
    m.base = L.tileLayer(def.url,{attribution:def.attribution,maxZoom:19,className:state.basemap==='dark'?'basemap-dark':''}).addTo(m.map);
    m.base.on('tileerror',()=>{if(!m.tileWarning){m.tileWarning=true;toast('Background map tiles could not load. Internet is needed for the basemap; all historical data is local.');}});
    if (def.labels) m.labels = L.tileLayer(def.labels,{pane:'overlayPane',maxZoom:19,subdomains:'abcd',opacity:.9}).addTo(m.map);
    else m.labels=null;
  }
}
function toggleCompare(compare) {
  const wasCompare=state.compare;
  state.compare=compare;
  $('maps').classList.toggle('compare',compare); $('map-compare').hidden=!compare; $('main-pane-label').hidden=!compare;
  $('view-single').classList.toggle('selected',!compare); $('view-compare').classList.toggle('selected',compare);
  $('view-single').setAttribute('aria-pressed',String(!compare)); $('view-compare').setAttribute('aria-pressed',String(compare));
  if (compare) {
    state.visible.reflectivity=true; state.visible.velocity=true;
    $('layer-reflectivity').checked=true; $('layer-velocity').checked=true;
  } else if(wasCompare) {
    state.visible.velocity=false;$('layer-velocity').checked=false;
  }
  requestAnimationFrame(()=>{
    const center=maps[0].map.getCenter(), zoom=maps[0].map.getZoom();
    syncLock=true;
    for(const m of maps){m.map.invalidateSize({pan:false});m.map.setView(center,zoom,{animate:false});}
    syncLock=false; render();
  });
}
function showTab(name) {
  for(const b of document.querySelectorAll('[data-tab]')) {const active=b.dataset.tab===name;b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active));}
  for(const p of document.querySelectorAll('.tab-panel'))p.hidden=p.id!=='panel-'+name;
  document.querySelector('.notebook').scrollTop=0;
}
function hasBreak(s,t) {
  return (s.breakIntervals||[]).some(b=>t>date(b.start)&&t<date(b.end));
}
function spotterPosition(s,t) {
  return hasBreak(s,t)?null:positionAt(s.points,t,(s.interpolationLimitSeconds||120)*1000);
}
function spotterSegments(s,t) {
  const segments=[]; let segment=[];
  for(const p of s.points) {
    if(p.t>t)break;
    const previous=segment.at(-1);
    const blocked=previous&&(s.breakIntervals||[]).some(b=>date(b.start)<p.t&&date(b.end)>previous.t);
    if(previous&&(p.t-previous.t>(s.interpolationLimitSeconds||120)*1000||blocked)){segments.push(segment);segment=[];}
    segment.push(p);
  }
  const current=spotterPosition(s,t);if(current?.status==='interpolated')segment.push(current);
  if(segment.length)segments.push(segment);return segments.map(s=>s.map(latlng));
}
function spotterPopup(s,p) {
  let html=sourcePopup(s.name,(s.imported?'Imported, unverified':'El Reno Survey camera position')+' · '+(p.status==='recorded'?'source observation':'interpolated')+' · '+fmt(state.t)+' '+zoneLabel(),s.sourceUrl);
  const videos=(s.videos||[]).map(id=>data.videos.videos.find(v=>v.id===id)).filter(Boolean);
  for(const v of videos)html+='<br>'+link(v.url,v.title);
  if(s.surveyVideoUrl)html+='<br>'+link(s.surveyVideoUrl,'Survey camera footage');
  if(s.username)html+='<small>'+esc(s.username)+'</small>';
  return html;
}
function updatePeople(m) {
  let active=0;
  spotters.forEach((s,i)=>{
    const p=spotterPosition(s,state.t);
    let marker=m.people.get(s.id);
    if(p&&state.visible.spotters){
      active++;
      if(!marker){
        marker=L.marker(latlng(p),{icon:s.kind==='twistex'?vehicleIcon(true):L.divIcon({className:'spotter-dot',iconSize:[10,10],iconAnchor:[5,5]}),zIndexOffset:100,title:s.name,alt:s.name})
          .bindTooltip(esc(s.name),{direction:'top',className:'marker-label'}).bindPopup('');
        m.people.set(s.id,marker);
      }
      marker.setLatLng(latlng(p)).setOpacity(state.opacity.spotters);
      marker.setPopupContent(spotterPopup(s,p));setPresent(m.map,marker,true);
    }else if(marker)setPresent(m.map,marker,false);
  });
  const selected=spotters.find(s=>s.id===state.selectedSpotter);
  if(selected){m.selectedTrail.setLatLngs(spotterSegments(selected,state.t)).setStyle({opacity:.65*state.opacity.spotters});setPresent(m.map,m.selectedTrail,state.visible.spotters);}
  else setPresent(m.map,m.selectedTrail,false);
  return active;
}
function updateRadar(m,index) {
  for(const product of ['reflectivity','velocity']) {
    const allowed=state.visible[product]&&(!state.compare|| (index===0?product==='reflectivity':product==='velocity'));
    const selection=allowed?radarFrameAt(data.radar.frames,state.t,product):null;
    const file=selection?.frame[product];
    if(m.radarFiles[product]!==file) {
      if(m.overlays[product])m.overlays[product].remove();
      m.radarFiles[product]=file;m.radarFailed[product]=false;
      if(file){
        const overlay=L.imageOverlay(file,data.radar.bounds,{pane:'radar',opacity:state.opacity[product],interactive:false,className:'radar-image'});
        overlay.on('error',()=>{if(m.radarFiles[product]===file){m.radarFailed[product]=true;toast('A local radar image could not load. See source data for this scan.');}});
        m.overlays[product]=overlay;overlay.addTo(m.map);
      } else m.overlays[product]=null;
    }
    if(m.overlays[product])m.overlays[product].setOpacity(state.opacity[product]);
  }
}
function updateLegend() {
  const product=state.visible.velocity&&!state.compare?'velocity':'reflectivity';
  const shown=state.visible.reflectivity||state.visible.velocity;
  $('radar-legend').hidden=!shown;
  const palette=data.radar.colorScales[product], stops=palette.stops;
  const lo=stops[0][0],hi=stops.at(-1)[0];
  const gradient=[];
  for(let i=0;i<stops.length-1;i++){
    gradient.push(stops[i][1]+' '+((stops[i][0]-lo)/(hi-lo)*100)+'%',stops[i][1]+' '+((stops[i+1][0]-lo)/(hi-lo)*100)+'%');
  }
  gradient.push(stops.at(-1)[1]+' 100%');
  $('legend-bar').style.background='linear-gradient(to right,'+gradient.join(',')+')';
  $('legend-title').textContent=product==='velocity'?'RADIAL VELOCITY':'REFLECTIVITY';
  $('legend-unit').textContent=palette.units;
  $('legend-ticks').innerHTML=(product==='velocity'?[-100,-50,0,50,100]:[-10,10,35,60,80]).map(n=>'<span style="left:'+((n-lo)/(hi-lo)*100)+'%">'+n+'</span>').join('');
  $('radar-legend').title=product==='velocity'?'Negative: toward KTLX. Positive: away. Raw base velocity, not dealiased; folding can occur near ±55 kt.':'Native Level II reflectivity, 250 m range gates.';
  let second=$('velocity-legend');
  if(!second){second=document.createElement('div');second.id='velocity-legend';second.className='radar-legend second-legend';document.querySelector('.map-workspace').append(second);}
  second.hidden=!state.compare||!state.visible.velocity;
  document.querySelector('.map-workspace').classList.toggle('comparison-legends',state.compare);
  if(state.compare){
    const vs=data.radar.colorScales.velocity.stops,g=[];
    for(let i=0;i<vs.length-1;i++)g.push(vs[i][1]+' '+((vs[i][0]+100)/2)+'%',vs[i][1]+' '+((vs[i+1][0]+100)/2)+'%');
    g.push(vs.at(-1)[1]+' 100%');
    second.innerHTML='<div><span>RADIAL VELOCITY</span><span>kt</span></div><div class="colorbar" style="background:linear-gradient(to right,'+g.join(',')+')"></div><div class="legend-ticks">'+[-100,-50,0,50,100].map(n=>'<span style="left:'+((n+100)/2)+'%">'+n+'</span>').join('')+'</div>';
    second.title='Negative toward KTLX; positive away. Undealiased base velocity; folding near ±55 kt.';
    $('radar-legend').hidden=!state.visible.reflectivity;
  }
}
function render() {
  if(!data)return;
  const car=positionAt(track,state.t,300000,state.offset), tornado=positionAt(centers,state.t,60000);
  const both=car&&tornado, distance=both?haversine(car,tornado):null;
  const route=splitTrack(track,300000,state.t,state.offset).map(s=>s.map(latlng));
  for(const [index,m] of maps.entries()){
    if(index===1&&!state.compare)continue;
    updateRadar(m,index);
    m.swath.setStyle({opacity:state.opacity.swath,fillOpacity:state.opacity.swath*.14});
    m.centerPath.setStyle({opacity:state.opacity.swath*.45});
    setPresent(m.map,m.swath,state.visible.swath);setPresent(m.map,m.centerPath,state.visible.swath);
    m.fullRoute.setStyle({opacity:state.opacity.track*.18});
    m.route.setLatLngs(route).setStyle({opacity:state.opacity.track});
    m.routeShadow.setLatLngs(route).setStyle({opacity:state.opacity.track*.75});
    for(const l of [m.fullRoute,m.routeShadow,m.route])setPresent(m.map,l,state.visible.track);
    if(car){
      m.car.setLatLng(latlng(car)).setOpacity(state.opacity.track);
      m.car.setPopupContent('<strong>Shane Motley / smotley</strong><small>'+esc(car.status==='recorded'?'Recorded camera GPS':'Interpolated camera GPS · '+car.gapSeconds+'s between fixes')+'</small><small>'+esc(fmt(state.t)+' '+zoneLabel())+'</small><small>Camera clock unverified'+(state.offset?' · correction '+state.offset/60000+' min':' · UTC assumed')+'</small><small>'+car.lat.toFixed(5)+', '+car.lon.toFixed(5)+'</small>');
      setPresent(m.map,m.car,state.visible.track);
      if(car.before&&car.after){const body=m.car.getElement()?.querySelector('.vehicle-body');if(body)body.style.transform='rotate('+bearing(car.before,car.after)+'deg)';}
    }else setPresent(m.map,m.car,false);
    if(tornado){
      m.center.setLatLng(latlng(tornado)).setOpacity(state.opacity.center);
      m.center.setPopupContent(sourcePopup('Estimated tornado center',(tornado.status==='recorded'?'NWS minute estimate':'Interpolated between NWS minute estimates')+' · '+fmt(state.t)+' '+zoneLabel(),data.timeline.sourceUrl));
      setPresent(m.map,m.center,state.visible.center);
    }else setPresent(m.map,m.center,false);
    if(both)m.separation.setLatLngs([latlng(car),latlng(tornado)]);
    setPresent(m.map,m.separation,!!both&&state.visible.center&&state.visible.track);
    updatePeople(m);
  }
  if(car&&state.follow)maps[0].map.panTo(latlng(car),{animate:false});
  $('distance').textContent=distance===null?'—':(distance/MI).toFixed(1);
  $('distance-unit').hidden=distance===null;
  $('position-quality').textContent=both?'PROVISIONAL':'NO ESTIMATE';
  $('distance-caption').textContent=both?'Center separation · clock unverified':!car?'No camera position in this interval':'No NWS center at this time';
  const formatted=fmt(state.t);
  $('current-time').innerHTML=esc(formatted).replace(/ (AM|PM)$/,' <small>$1</small>');
  const dateText=new Intl.DateTimeFormat('en-US',{timeZone:state.zone,month:'short',day:'numeric',year:'numeric'}).format(state.t).toUpperCase();
  $('time-date').firstChild.textContent=dateText+' ';
  $('timezone').textContent=zoneLabel()+' ▾';
  $('time-slider').value=state.t;
  $('time-slider').style.setProperty('--progress',((state.t-state.start)/(state.end-state.start)*100)+'%');
  $('time-slider').setAttribute('aria-valuetext',fmt(state.t)+' '+zoneLabel());
  const products=['reflectivity','velocity'].filter(p=>state.visible[p]);
  const readings=products.map(p=>{
    const r=radarFrameAt(data.radar.frames,state.t,p);
    return (p==='reflectivity'?'REF':'VEL')+' '+(r?fmt(r.t)+' · '+Math.floor(r.ageSeconds/60)+'m '+Math.floor(r.ageSeconds%60)+'s old':'no scan in range');
  });
  $('radar-status').textContent=readings.join(' / ')||'Both radar layers are off';
  $('radar-title').textContent=state.visible.velocity?'KTLX / BASE VELOCITY NOT DEALIASED':'KTLX / ARCHIVED LEVEL II';
  const p=products[0],r=p?radarFrameAt(data.radar.frames,state.t,p):null;
  $('radar-elevation').textContent=r?'0.5°':'—';
  $('radar-elevation').title=r?'Nominal low tilt; encoded target '+r.frame[p+'Elevation']+'°. Radar times are representative sweep midpoints.':'';
  const noRadar=products.length&&!products.some(p=>radarFrameAt(data.radar.frames,state.t,p));
  $('map-notice').hidden=!noRadar;
  if(noRadar)$('map-notice').textContent='No radar scan within the preceding 10 minutes. The bundled radar covers 5:42–7:14 PM CDT.';
  updateLegend();
}
function updateClosest() {
  best=closestApproach(track,centers,state.offset);
  $('closest-value').textContent=best?(best.meters/MI).toFixed(1)+' mi · '+fmt(best.t,false):'No overlap';
  $('closest').disabled=!best;
  $('clock-status').textContent=state.offset?'Camera correction: '+(state.offset>0?'+':'')+(state.offset/60000).toFixed(1)+' min':'Camera clock: UTC assumed';
  $('clock-offset').value=state.offset/60000;
}
function setRange(range) {
  state.range=range;
  if(range==='storm'){state.start=STORM_START;state.end=STORM_END;}
  else{state.start=Math.min(track[0].t+state.offset,STORM_START,...spotters.map(s=>s.points[0].t));state.end=Math.max(track.at(-1).t+state.offset,STORM_END,...spotters.map(s=>s.points.at(-1).t));}
  $('time-slider').min=state.start;$('time-slider').max=state.end;
  $('range-storm').classList.toggle('selected',range==='storm');$('range-day').classList.toggle('selected',range==='day');
  $('timeline-label').textContent=range==='storm'?'THE TORNADO WINDOW':'THE FULL CHASE';
  $('time-ticks').innerHTML=Array.from({length:5},(_,i)=>'<span>'+esc(fmt(state.start+(state.end-state.start)*i/4,false))+'</span>').join('');
  $('tornado-period').style.left=((centers[0].t-state.start)/(state.end-state.start)*100)+'%';
  $('tornado-period').style.width=((centers.at(-1).t-centers[0].t)/(state.end-state.start)*100)+'%';
  $('event-markers').replaceChildren();
  for(const event of data.timeline.events||[]){
    const t=date(event.time);if(t<state.start||t>state.end)continue;
    const b=document.createElement('button');b.style.left=((t-state.start)/(state.end-state.start)*100)+'%';
    b.title=fmt(t,false)+' · '+event.title;b.setAttribute('aria-label',b.title);
    b.addEventListener('click',()=>{setTime(t);toast(event.title+': '+(event.detail||event.description||''));});
    $('event-markers').append(b);
  }
  setTime(Math.min(state.end,Math.max(state.start,state.t)));
}
function setTime(t){state.t=Math.min(state.end,Math.max(state.start,t));render();}
function setPlaying(playing) {
  state.playing=playing;
  $('play').setAttribute('aria-label',playing?'Pause timeline':'Play timeline');
  $('play').innerHTML=playing?'<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 5H10V19H6ZM14 5H18V19H14Z" fill="currentColor"/></svg>':'<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M8 4L20 12L8 20Z" fill="currentColor"/></svg>';
  cancelAnimationFrame(animationId);
  if(playing){if(state.t>=state.end)state.t=state.start;lastFrame=0;lastDraw=0;animationId=requestAnimationFrame(tick);}
}
function tick(now) {
  if(!state.playing)return;
  if(lastFrame)state.t=Math.min(state.end,state.t+Math.min(now-lastFrame,250)*state.speed);
  lastFrame=now;
  if(now-lastDraw>100){render();lastDraw=now;}
  if(state.t>=state.end){render();setPlaying(false);return;}
  animationId=requestAnimationFrame(tick);
}
function step(direction) {
  setPlaying(false);
  const product=state.visible.velocity&&!state.visible.reflectivity?'velocity':'reflectivity';
  const times=data.radar.frames.map(f=>state.compare?Math.max(date(f.reflectivityTime),date(f.velocityTime)):date(f[product+'Time']||f.time)).sort((a,b)=>a-b);
  const next=direction>0?times.find(t=>t>state.t+1):times.filter(t=>t<state.t-1).at(-1);
  setTime(next??(direction>0?state.end:state.start));
}
function jumpSpotter(s) {
  state.selectedSpotter=s.id;
  let p=spotterPosition(s,state.t);
  if(!p){
    p=s.points.reduce((a,b)=>Math.abs(b.t-state.t)<Math.abs(a.t-state.t)?b:a);
    if(p.t<state.start||p.t>state.end)setRange('day');
    // Survey observations can precede the camera day; expand only to the selected evidence.
    if(p.t<state.start||p.t>state.end){state.start=Math.min(state.start,p.t);state.end=Math.max(state.end,p.t);$('time-slider').min=state.start;$('time-slider').max=state.end;}
    setTime(p.t);toast('Jumped to '+s.name+'’s recorded position at '+fmt(p.t)+' '+zoneLabel()+'.');
  }
  state.visible.spotters=true;$('layer-spotters').checked=true;
  maps[0].map.setView(latlng(p),Math.max(12,maps[0].map.getZoom()));
  render();maps[0].people.get(s.id)?.openPopup();
  if(window.innerWidth<=850){document.querySelector('.notebook').classList.remove('open');$('mobile-menu').setAttribute('aria-expanded','false');}
}
function buildPeople() {
  $('people-count').textContent=spotters.length;
  $('people-list').replaceChildren();
  const missing=document.createElement('article');missing.className='person-card unavailable';
  missing.innerHTML='<div class="person-top"><span class="person-avatar">TS</span><div class="person-info"><strong>Tim Samaras / TWISTEX</strong><span>Track not yet verified</span></div></div><p>A white vehicle marker is reserved for an attributable timed track. No position is inferred from another chaser or a crash-site location.</p>';
  $('people-list').append(missing);
  spotters.forEach((s,i)=>{
    const card=document.createElement('article');card.className='person-card';
    const initials=s.name.split(/[ ,]+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('');
    card.innerHTML='<div class="person-top"><span class="person-avatar" style="color:'+colors[i%colors.length]+'">'+esc(initials)+'</span><div class="person-info"><strong>'+esc(s.name)+'</strong><span>'+s.points.length+' positions · '+(s.imported?'imported, unverified':'survey camera')+'</span></div><button class="person-go" aria-label="Locate '+esc(s.name)+'">↗</button></div><div class="person-links">'+link(s.sourceUrl,'Source')+link(s.surveyVideoUrl,'Survey film')+(s.videos||[]).map(id=>{const v=data.videos.videos.find(v=>v.id===id);return v?link(v.url,'YouTube'):'';}).join('')+'</div>';
    card.querySelector('button').addEventListener('click',()=>jumpSpotter(s));$('people-list').append(card);
  });
  $('spotter-note').innerHTML='<strong>These are survey camera positions.</strong><p>'+esc(data.spotters.sourceNotes)+'</p><p>Markers appear only at an observation or across gaps of at most two minutes. Missing reports and flagged jumps stay empty.</p>';
}
function buildVideos() {
  $('video-list').replaceChildren();
  data.videos.videos.forEach((v,i)=>{
    const card=document.createElement('article');card.className='video-card';
    card.innerHTML='<a class="video-cover" href="'+esc(safeURL(v.url))+'" target="_blank" rel="noopener noreferrer" aria-label="Watch '+esc(v.title)+'"><span class="film-label">31 MAY 2013 / ORIGINAL FOOTAGE</span><span class="video-play">▶</span><span class="film-number">'+String(i+1).padStart(2,'0')+'</span></a><div class="video-info"><h3>'+esc(v.title)+'</h3><div class="creator">'+esc(v.creator)+'</div><p>'+esc(v.description)+'</p><div class="video-foot"><span>'+(v.time?'TIMED LOCATION':'TIMING NOT REGISTERED')+'</span>'+link(v.url,'Watch original')+'</div></div>';
    $('video-list').append(card);
  });
}
function bindControls() {
  document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.tab)));
  for(const layer of Object.keys(state.visible)){
    $('layer-'+layer).addEventListener('change',e=>{
      state.visible[layer]=e.target.checked;
      if(!state.compare&&e.target.checked&&['reflectivity','velocity'].includes(layer)){
        const other=layer==='reflectivity'?'velocity':'reflectivity';state.visible[other]=false;$('layer-'+other).checked=false;
      }
      render();
    });
    $('opacity-'+layer).addEventListener('input',e=>{state.opacity[layer]=Number(e.target.value)/100;const output=$('opacity-'+layer+'-value');if(output)output.textContent=e.target.value+'%';render();});
  }
  $('view-single').addEventListener('click',()=>toggleCompare(false));$('view-compare').addEventListener('click',()=>toggleCompare(true));
  $('basemap').addEventListener('change',e=>{state.basemap=e.target.value;setBasemap();});
  $('follow').addEventListener('click',()=>{state.follow=!state.follow;$('follow').setAttribute('aria-pressed',String(state.follow));render();});
  $('fit-route').addEventListener('click',()=>{state.follow=false;$('follow').setAttribute('aria-pressed','false');maps[0].map.fitBounds(track.map(latlng),{padding:[45,65]});});
  $('fit-storm').addEventListener('click',()=>{state.follow=false;$('follow').setAttribute('aria-pressed','false');maps[0].map.setView([35.455,-97.985],11);});
  $('play').addEventListener('click',()=>setPlaying(!state.playing));$('step-back').addEventListener('click',()=>step(-1));$('step-forward').addEventListener('click',()=>step(1));
  $('speed').addEventListener('change',e=>state.speed=Number(e.target.value));
  $('time-slider').addEventListener('input',e=>{setPlaying(false);setTime(Number(e.target.value));});
  $('range-storm').addEventListener('click',()=>setRange('storm'));$('range-day').addEventListener('click',()=>setRange('day'));
  $('timezone').addEventListener('click',()=>{state.zone=state.zone==='UTC'?'America/Chicago':'UTC';updateClosest();setRange(state.range);});
  $('closest').addEventListener('click',()=>{if(!best)return;setPlaying(false);if(best.t<state.start||best.t>state.end)setRange('day');setTime(best.t);maps[0].map.fitBounds([latlng(best.car),latlng(best.tornado)],{padding:[90,140],maxZoom:13});toast('Estimated center separation: '+(best.meters/MI).toFixed(1)+' mi at '+fmt(best.t)+' '+zoneLabel()+'. Both positions interpolated; camera clock unverified.');});
  for(const id of ['sources-open','distance-info'])$(id).addEventListener('click',()=>$('sources-dialog').showModal());
  $('clock-open').addEventListener('click',()=>$('clock-dialog').showModal());
  document.querySelectorAll('.dialog-close').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
  $('clock-apply').addEventListener('click',()=>{
    const n=Number($('clock-offset').value);if(!Number.isFinite(n)||Math.abs(n)>720){$('clock-offset').reportValidity();return;}
    state.offset=n*60000;updateClosest();setRange(state.range);$('clock-dialog').close();toast('Camera times shifted by '+n+' minutes. The original GPS file is unchanged.');
  });
  $('clock-reset').addEventListener('click',()=>{state.offset=0;updateClosest();setRange(state.range);$('clock-dialog').close();});
  $('mobile-menu').addEventListener('click',()=>{const open=document.querySelector('.notebook').classList.toggle('open');$('mobile-menu').setAttribute('aria-expanded',String(open));});
  $('spotter-import').addEventListener('change',async e=>{
    try{
      const file=e.target.files[0];if(!file)return;if(file.size>15*1024*1024)throw new Error('Please use a file smaller than 15 MB.');
      const imported=validateSpotterImport(JSON.parse(await file.text()));
      const existing=new Set(spotters.map(s=>s.id));
      imported.forEach((s,i)=>{s.id='import-'+Date.now()+'-'+i;if(existing.has(s.id))throw new Error('Duplicate track ID.');});
      spotters.push(...imported);buildPeople();render();$('import-status').textContent='Added '+imported.length+' tracks to this session. Imported identity and positions are unverified.';
    }catch(error){$('import-status').textContent=error.message;}finally{e.target.value='';}
  });
  document.addEventListener('keydown',e=>{
    if(/INPUT|SELECT|TEXTAREA|BUTTON/.test(e.target.tagName)||document.querySelector('dialog[open]'))return;
    if(e.code==='Space'){e.preventDefault();setPlaying(!state.playing);}
    if(e.key==='ArrowRight'){e.preventDefault();setPlaying(false);setTime(state.t+10000);}
    if(e.key==='ArrowLeft'){e.preventDefault();setPlaying(false);setTime(state.t-10000);}
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden)setPlaying(false);});
}
async function init() {
  try {
    if(!window.L)throw new Error('The bundled map library could not load. Start the local server rather than opening index.html directly.');
    const values=await Promise.all(['GPS.json','data/tornado.geojson','data/tornado-timeline.json','data/radar/manifest.json','data/spotters.json','data/videos.json'].map(loadJSON));
    data={gps:values[0],tornado:values[1],timeline:values[2],radar:values[3],spotters:values[4],videos:values[5]};
    track=normalizePoints(data.gps.data);centers=normalizePoints(data.timeline.points);
    spotters=data.spotters.spotters.map(s=>({...s,points:normalizePoints(s.points)}));
    maps=[makeMap('map'),makeMap('map-compare',true)];
    setBasemap();buildPeople();buildVideos();bindControls();updateClosest();setRange('storm');
    $('track-summary').textContent=track.length+' original GPS fixes · no long-gap interpolation';
    const sources=[
      {label:'Original camera GPS · smotley',url:'https://github.com/smmotley/El_Reno/blob/master/GPS.json'},
      {label:'NWS Norman · May 31 event and official tornado survey',url:data.timeline.sourcePageUrl},
      {label:'NWS · original timed center positions (KMZ)',url:data.timeline.sourceUrl},
      ...(data.radar.sources||[]),...(data.spotters.sources||[])
    ];
    $('source-list').innerHTML=sources.map(s=>link(s.url,s.label||s.title||s.name||s.url)).join('');
    // Preload the small bundled radar images. No external radar service is needed.
    for(const f of data.radar.frames)for(const p of ['reflectivity','velocity']){const img=new Image();img.src=f[p];}
  } catch(error) {
    $('map-notice').hidden=false;$('map-notice').textContent=error.message;
    $('radar-status').textContent='Unable to load reconstruction';$('closest-value').textContent='Unavailable';$('closest').disabled=true;
    console.error(error);
  }
}
init();
