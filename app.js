import { MI, normalizePoints, haversine, positionAt, validateSpotterImport } from './js/analysis.js';
import { prepareRoadTrack, roadPositionAt, roadSegmentsUntil, closestRoadApproach } from './js/road-motion.js';
import { snapTimelineTime, buildRadarEvents } from './js/timeline.js';
import { selectRadarFrame, radarCoverage, createVolumeRadarSource } from './js/radar-source.js';
import { prepareSurface, surfacePosition } from './js/air-surface.js';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeURL = value => { try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } };
const link = (url, label) => safeURL(url) ? '<a href="' + esc(safeURL(url)) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + ' ↗</a>' : '';
const date = value => Date.parse(value);
const STORM_START = date('2013-05-31T22:45:00Z'), STORM_END = date('2013-06-01T00:15:00Z');
const state = {
  t: date('2013-05-31T23:10:20Z'), start: STORM_START, end: STORM_END,
  offset: 0, zone: 'America/Chicago', playing: false, speed: 30, compare: false,
  follow: false, basemap: 'dark', radarSource: 'ktlx', volume: false, volumeSurface: true, range: 'storm', selectedSpotter: null,
  visible: { reflectivity: true, velocity: false, track: true, swath: true, center: true, spotters: true },
  opacity: { reflectivity: .72, velocity: .78, track: 1, swath: .7, center: 1, spotters: 1 }
};
let data, track = [], roadTrack, roadTracks = {}, centers = [], spotters = [], radarEvents = [], best, maps = [], syncLock = false, toastTimer;
let animationId, lastFrame = 0, lastDraw = 0;
const radarImageCache = new Map();
let volumeViewer, volumeLoadVersion=0;
let activeVolumeMarkers=new Map();
const featuredChasers = {
  'survey-holcomb': {name:'Ben Holcomb',color:'#ffb454'},
  'survey-sullivan': {name:'Brandon Sullivan',color:'#ff7fa5'},
  'survey-talbot': {name:'Skip Talbot',color:'#b29aff'}
};
function chaserColor(s){return featuredChasers[s.id]?.color||'#8eb5bc';}
const SUV = '<svg viewBox="0 0 30 52" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><ellipse cx="15" cy="28" rx="13" ry="23" fill="#0c140f" opacity=".35"/><rect x="3" y="9" width="5" height="10" rx="2" fill="#151b18"/><rect x="22" y="9" width="5" height="10" rx="2" fill="#151b18"/><rect x="3" y="34" width="5" height="10" rx="2" fill="#151b18"/><rect x="22" y="34" width="5" height="10" rx="2" fill="#151b18"/><rect x="5" y="3" width="20" height="45" rx="6" fill="#a4ada9" stroke="#e2e6e1" stroke-width="1.1"/><path d="M8 13L22 13L21 21H9Z" fill="#334a4b"/><rect x="9" y="23" width="12" height="12" rx="2" fill="#87928e"/><path d="M9 37H21L22 42H8Z" fill="#354a47"/><path d="M7 8H11M19 8H23" stroke="#f5ebc5" stroke-width="2.5"/><path d="M7 45H11M19 45H23" stroke="#953f33" stroke-width="2"/><path d="M8 24V34M22 24V34" stroke="#d9dfd8"/></svg>';
$('vehicle-thumbnail').innerHTML = SUV;

function fmt(t, seconds = true) {
  return new Intl.DateTimeFormat('en-US', { timeZone: state.zone, hour: 'numeric', minute: '2-digit', ...(seconds ? {second: '2-digit'} : {}), hour12: state.zone !== 'UTC' }).format(t);
}
function zoneLabel() { return state.zone === 'UTC' ? 'UTC' : 'CDT'; }
function currentRadar() { return state.volume?data.volumeRadar:data.radars[state.radarSource]; }
function selectedRadar(product) { return selectRadarFrame(currentRadar(),state.t,product); }
function exitVolumeMode() {
  volumeLoadVersion++;
  if(!state.volume)return;
  state.volume=false;volumeViewer?.setActive(false);
  document.querySelector('.map-workspace').classList.remove('volume-mode');
  $('volume-stage').hidden=true;$('view-volume').classList.remove('selected');$('view-volume').setAttribute('aria-pressed','false');
  $('view-single').classList.add('selected');$('view-single').setAttribute('aria-pressed','true');
  radarEvents=currentRadarEvents();buildRadarRails();
}
async function enterVolumeMode() {
  if(state.volume)return;
  const version=++volumeLoadVersion;
  setPlaying(false);
  try {
    if(!data.volumeRadar)data.volumeRadar=createVolumeRadarSource(data.radars.air,await loadJSON('data/air-volume/manifest.json'));
    if(version!==volumeLoadVersion)return;
    if(!data.volumeRadar)throw new Error('The 3D scan files are not available. The 2D map remains available.');
    if(!data.airSurface)data.airSurface=prepareSurface(await loadJSON('data/air-surface.json'),data.roads);
    if(version!==volumeLoadVersion)return;
    const {AirVolumeViewer}=await import('./js/air-volume-viewer.js');
    if(version!==volumeLoadVersion)return;
    if(!volumeViewer)volumeViewer=new AirVolumeViewer($('volume-canvas'),{onMarkerSelect:selected=>{
      const marker=activeVolumeMarkers.get(selected.id);if(marker)toast(marker.description);
    },onStatus:status=>{
      $('volume-load-status').textContent=status.message;
      $('volume-load-status').dataset.state=status.state;
    }});
    setRadarSource('air');toggleCompare(false);
    state.volume=true;state.visible.reflectivity=true;$('layer-reflectivity').checked=true;
    document.querySelector('.map-workspace').classList.add('volume-mode');$('volume-stage').hidden=false;
    $('view-volume').classList.add('selected');$('view-volume').setAttribute('aria-pressed','true');
    $('view-single').classList.remove('selected');$('view-single').setAttribute('aria-pressed','false');
    radarEvents=currentRadarEvents();radarImageCache.clear();
    state.speed=5;$('speed').value='5';
    volumeViewer.setActive(true);volumeViewer.setThreshold(Number($('volume-threshold').value));
    setRange('air');requestAnimationFrame(()=>volumeViewer.resize());
  } catch(error){if(version===volumeLoadVersion)toast(error.message);}
}
function currentRadarEvents() {
  return buildRadarEvents(currentRadar().frames,-8640000000000000,8640000000000000)
    .filter(event=>!currentRadar().unavailableProducts?.[event.product]);
}
function updateVolumeSurface(car) {
  volumeViewer?.setSurface(state.volumeSurface?data.airSurface:null);
  const markers=[];
  const add=(id,label,point,color,kind,opacity,priority)=>{
    const position=surfacePosition(point,data.airSurface);if(!position)return;
    markers.push({id,label,...position,color,kind,opacity,priority,headingDegrees:point.headingDegrees,
      description:label+' · '+fmt(state.t)+' '+zoneLabel()+' · '+motionText(point)+' · '+speedText(point)+'. Ground elevation estimated from terrain data; AIR alignment unverified.'});
  };
  if(state.volumeSurface){
    if(state.visible.track&&car)add('smotley','OUR SUV',car,'#a4ada9','suv',state.opacity.track,3);
    if(state.visible.spotters)for(const spotter of spotters){
      const point=spotterPosition(spotter,state.t);
      if(point)add(spotter.id,spotter.name,point,chaserColor(spotter),'chaser',state.opacity.spotters,featuredChasers[spotter.id]?2:1);
    }
  }
  activeVolumeMarkers=new Map(markers.map(marker=>[marker.id,marker]));
  volumeViewer?.setMarkers(markers);
  $('volume-marker-count').textContent=state.volumeSurface?(markers.some(m=>m.kind==='suv')?'Our SUV · ':'')+markers.filter(m=>m.kind==='chaser').length+' survey chasers':'Surface hidden';
  $('volume-focus').disabled=!activeVolumeMarkers.has('smotley');
}
function velocityNote() {
  return state.radarSource==='air'
    ? 'AIR reflectivity research preview; geographic alignment is unverified. AIR velocity is unavailable here because of documented 2013 instrument limitations. Switch to WSR-88D for velocity.'
    : 'Negative: toward KTLX. Positive: away from KTLX. Raw base velocity, not dealiased; folding can occur near ±55 kt.';
}
function setRadarSource(source) {
  if(!data.radars[source]||source===state.radarSource)return;
  if(source!=='air')exitVolumeMode();
  setPlaying(false);state.radarSource=source;
  radarEvents=currentRadarEvents();
  radarImageCache.clear();
  for(const m of maps)for(const product of ['reflectivity','velocity']){
    m.overlays[product]?.remove();m.overlays[product]=null;m.radarFiles[product]=null;m.radarFailed[product]=false;
  }
  if(source==='air'){
    state.visible.reflectivity=true;state.visible.velocity=false;
    $('layer-reflectivity').checked=true;$('layer-velocity').checked=false;
    if(state.compare)toggleCompare(false);
    const coverage=radarCoverage(currentRadar());
    const moved=state.t<coverage.start||state.t>coverage.end;
    if(moved)state.t=coverage.start;
    setRange('air');
    if(moved)toast('AIR begins at '+fmt(coverage.start)+' '+zoneLabel()+'. Moved to its first available image.');
  }else setRange(state.range);
}
function updateRadarSourceUI() {
  const air=state.radarSource==='air', radar=currentRadar(), coverage=radarCoverage(radar);
  for(const source of ['ktlx','air']){
    $('source-'+source).classList.toggle('selected',source===state.radarSource);
    $('source-'+source).setAttribute('aria-pressed',String(source===state.radarSource));
  }
  document.querySelector('.map-workspace').classList.toggle('air-source',air);
  $('radar-source-detail').textContent=air?(state.volume?'AIR · 3D reflectivity · 45 elevations':'AIR · 0.5° reflectivity preview'):'KTLX · 0.5° · WSR-88D Level II';
  $('radar-source-detail').title=air?'University of Oklahoma Atmospheric Imaging Radar. Volume midpoint timing; individual ray times unavailable.':'NOAA/NWS WSR-88D near Oklahoma City. Independent product sweep midpoint times.';
  $('radar-source-window').textContent=air?fmt(coverage.start)+'–'+fmt(coverage.end)+' '+zoneLabel()+' · ~7–8 s updates':'~4–5 min volumes · '+zoneLabel()+' clock';
  const airWindow=radarCoverage(data.radars.air);
  $('air-coverage-copy').textContent=data.radars.air.frames.length+' reflectivity images, '+fmt(airWindow.start)+'–'+fmt(airWindow.end)+' '+zoneLabel()+'. No AIR image is held beyond the recording window or across a gap over 25 seconds.';
  $('layer-reflectivity-detail').textContent=air?(state.volume?'AIR · 45 elevation slices':'AIR · 0.5° research sweep'):'KTLX · lowest sweep';
  $('layer-velocity-detail').textContent=air?'Unavailable · 2013 instrument limitation':'Relative to KTLX · not dealiased';
  for(const id of ['layer-velocity','opacity-velocity','view-compare']){
    $(id).disabled=air;
    $(id).title=air?'AIR velocity is excluded because of documented 2013 instrument limitations. Switch to WSR-88D for velocity.':'';
  }
  $('layer-velocity').closest('.layer-row').classList.toggle('unavailable',air);
  $('radar-quality').hidden=!air;
  $('radar-quality').textContent='Research preview · clock / alignment unverified';
}
function prefetchRadarImages() {
  if(state.volume)return;
  const radar=currentRadar();
  let index=radar.frames.findIndex(f=>date(f.time)>state.t);
  if(index<0)index=radar.frames.length-1;
  const files=radar.frames.slice(Math.max(0,index-1),index+3).flatMap(f=>['reflectivity','velocity'].filter(p=>state.visible[p]).map(p=>f[p]));
  for(const file of files)if(file&&!radarImageCache.has(file)){
    const img=new Image();img.decoding='async';img.src=file;radarImageCache.set(file,img);
  }
  for(const file of radarImageCache.keys())if(!files.includes(file))radarImageCache.delete(file);
}

function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 5000); }
async function loadJSON(url) { const res = await fetch(url); if (!res.ok) throw new Error('Could not load ' + url); return res.json(); }
function latlng(p) { return [p.lat, p.lon]; }
function setPresent(map, layer, shown) { if (shown && !map.hasLayer(layer)) layer.addTo(map); else if (!shown && map.hasLayer(layer)) map.removeLayer(layer); }
function speedText(p) { return Number.isFinite(p?.averageSpeedMph) ? '≈ '+Math.round(p.averageSpeedMph)+' mph · inferred interval average' : 'Speed unavailable'; }
function motionText(p) { return ({'road-interpolated':'Inferred position along roads','road-matched':'Source fix matched to road','stationary':'Inferred stationary position','observed-unmatched':'Original fix · no road match'})[p.status] || 'Original observation'; }
function vehicleIcon(white = false) {
  return L.divIcon({ className: 'vehicle-icon', html: '<div class="vehicle-body">' + (white ? SUV.replace('#a4ada9','#f4f4ed').replace('#87928e','#d7ddd6') : SUV) + '</div>', iconSize: [24,42], iconAnchor: [12,21], popupAnchor: [0,-22] });
}
function sourcePopup(name, detail, url, label = 'Source') { return '<strong>' + esc(name) + '</strong><small>' + esc(detail) + '</small>' + link(url,label); }

function makeMap(id, isSecond = false) {
  const map = L.map(id, {zoomControl:false, preferCanvas:true, minZoom:5, maxZoom:17, zoomAnimation:false, fadeAnimation:false}).setView([35.455,-97.985], 11);
  map.attributionControl.setPrefix(false);
  L.control.zoom({position:'topright'}).addTo(map);
  if (!isSecond) L.control.scale({position:'bottomleft',imperial:true,metric:false,maxWidth:100}).addTo(map);
  for (const [name,z] of [['radar',250],['roads',310],['roadLabels',320],['survey',410],['tracks',420],['separation',425]]) {
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
  m.fullRoute = L.polyline(roadSegmentsUntil(roadTrack).map(s=>s.map(latlng)), {pane:'tracks',color:'#d7c29c',weight:1.2,opacity:.22,dashArray:'3 6'});
  m.car = L.marker([0,0],{icon:vehicleIcon(),zIndexOffset:500,title:'Shane Motley / smotley',alt:'Grey SUV — our chase'}).bindTooltip('OUR SUV',{permanent:true,direction:'right',offset:[12,0],className:'marker-label'}).bindPopup('');
  m.center = L.marker([0,0],{icon:L.divIcon({className:'tornado-marker',html:'⌁',iconSize:[28,28],iconAnchor:[14,14]}),zIndexOffset:400,title:'NWS estimated tornado center',alt:'Estimated tornado center'}).bindTooltip('NWS CENTER',{direction:'right',offset:[15,0],className:'marker-label'}).bindPopup('');
  m.separation = L.polyline([], {pane:'separation',color:'#e7cfaa',weight:1,dashArray:'3 6',opacity:.7,interactive:false});
  m.radarSite = L.circleMarker([0,0],{pane:'survey',radius:5,color:'#d9e5d3',fillColor:'#477b8c',fillOpacity:1,weight:1.5}).bindTooltip('',{direction:'right',className:'marker-label'}).bindPopup('');
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
  let resizeFrame;
  m.resizeObserver=new ResizeObserver(entries=>{
    if(!entries.some(e=>e.contentRect.width&&e.contentRect.height))return;
    cancelAnimationFrame(resizeFrame);
    resizeFrame=requestAnimationFrame(()=>map.invalidateSize({pan:false,debounceMoveend:true}));
  });
  m.resizeObserver.observe(map.getContainer());
  map.on('zoomend moveend',()=>updateRoadLabels(m));
  return m;
}
function setBasemap() {
  for (const m of maps) {
    if(m.base)m.base.remove();m.base=null;
    m.map.getContainer().classList.toggle('light-roads',state.basemap==='light');
    if(state.basemap==='satellite'){
      m.base=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Imagery © Esri, Maxar, Earthstar Geographics · Present-day context'}).addTo(m.map);
      m.base.on('tileerror',()=>{if(!m.tileWarning){m.tileWarning=true;toast('Some satellite images are unavailable. The locally stored road map remains visible.');}});
    }
    if(!m.roads){
      m.roads=L.geoJSON(data.roads,{filter:f=>f.geometry.type==='LineString',pane:'roads',interactive:false,style:roadStyle}).addTo(m.map);
      m.labels=L.layerGroup().addTo(m.map);
      m.map.attributionControl.addAttribution('Roads © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Current network, stored locally');
    }else m.roads.setStyle(roadStyle);
    updateRoadLabels(m);
  }
}
function roadStyle(f) {
  const major=/^(motorway|trunk|primary|secondary)/.test(f.properties.highway||'');
  return {color:state.basemap==='light'?(major?'#677965':'#97a38c'):(major?'#a8b6a0':'#78917a'),weight:major?2.2:1,opacity:major?.75:.48,lineCap:'round'};
}
function updateRoadLabels(m) {
  if(!m.labels)return;
  m.labels.clearLayers();
  const zoom=m.map.getZoom(), bounds=m.map.getBounds(), used=new Set(), occupied=[];
  for(const f of data.roads.features){
    const isPlace=f.geometry.type==='Point';
    if(!isPlace && (zoom<13||f.geometry.type!=='LineString'))continue;
    const name=isPlace?f.properties.name:(f.properties.ref||f.properties.name);
    if(!name||used.has(name))continue;
    const c=isPlace?f.geometry.coordinates:f.geometry.coordinates[Math.floor(f.geometry.coordinates.length/2)];
    const ll=L.latLng(c[1],c[0]);if(!bounds.contains(ll))continue;
    const xy=m.map.latLngToContainerPoint(ll);
    if(occupied.some(p=>Math.abs(p.x-xy.x)<100&&Math.abs(p.y-xy.y)<28))continue;
    used.add(name);occupied.push(xy);
    L.marker(ll,{pane:'roadLabels',interactive:false,keyboard:false,icon:L.divIcon({className:isPlace?'place-label':'road-label',html:esc(name),iconSize:[150,16],iconAnchor:[75,8]})}).addTo(m.labels);
    if(occupied.length>65)break;
  }
}
function toggleCompare(compare) {
  if(state.volume)exitVolumeMode();
  if(compare&&currentRadar().unavailableProducts?.velocity)return;
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
function spotterPosition(s,t) {
  const matched=roadTracks[s.id];
  if(matched)return roadPositionAt(matched,t);
  // Imported observations have no trusted road geometry. Never draw a chord.
  const point=s.points.find(p=>p.t===t);
  return point?{...point,status:'observed-unmatched',averageSpeedMph:null}:null;
}
function spotterSegments(s,t) {
  return roadTracks[s.id]?roadSegmentsUntil(roadTracks[s.id],t).map(s=>s.map(latlng)):[];
}
function spotterPopup(s,p) {
  let html=sourcePopup(s.name,(s.imported?'Imported, unverified':'El Reno Survey camera position')+' · '+motionText(p)+' · '+fmt(state.t)+' '+zoneLabel(),s.sourceUrl);
  html+='<small>'+esc(speedText(p))+'</small>';
  if(p.gapSeconds)html+='<small>'+p.gapSeconds+' seconds between source positions</small>';
  if(Number.isFinite(p.snapDistanceMeters))html+='<small>Road match: '+Math.round(p.snapDistanceMeters)+' m from source fix</small>';
  const videos=(s.videos||[]).map(id=>data.videos.videos.find(v=>v.id===id)).filter(Boolean);
  for(const v of videos)html+='<br>'+link(v.url,v.title+(v.playbackStatus==='private'&&!/private/i.test(v.title)?' (private)':''));
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
        marker=L.marker(latlng(p),{icon:s.kind==='twistex'?vehicleIcon(true):L.divIcon({className:'spotter-dot'+(featuredChasers[s.id]?' featured-dot':''),html:'<span style="--chaser-color:'+chaserColor(s)+'"></span>',iconSize:[12,12],iconAnchor:[6,6]}),zIndexOffset:100,title:s.name,alt:s.name})
          .bindTooltip(esc(s.name),{direction:'top',className:'marker-label'}).bindPopup('');
        m.people.set(s.id,marker);
      }
      marker.setLatLng(latlng(p)).setOpacity(state.opacity.spotters);
      marker.setPopupContent(spotterPopup(s,p));marker.setTooltipContent(esc(s.name)+'<br>'+esc(speedText(p)));setPresent(m.map,marker,true);
      const body=marker.getElement()?.querySelector('.vehicle-body');if(body)body.style.transform='rotate('+(p.headingDegrees??0)+'deg)';
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
    const selection=allowed?selectedRadar(product):null;
    const file=selection?.frame[product];
    if(m.radarFiles[product]!==file) {
      if(m.overlays[product])m.overlays[product].remove();
      m.radarFiles[product]=file;m.radarFailed[product]=false;
      if(file){
        const overlay=L.imageOverlay(file,currentRadar().bounds,{pane:'radar',opacity:state.opacity[product],interactive:false,className:'radar-image'});
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
  const palette=currentRadar().colorScales[product], stops=palette.stops;
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
  $('radar-legend').title=product==='velocity'?velocityNote():(state.radarSource==='air'?(state.volume?'AIR reflectivity from 45 elevations, −2° to 20°.':'AIR reflectivity at 0.5°.')+' Research preview; alignment and calibration are unverified. 30 m gate spacing is not independent spatial resolution.':'Native Level II reflectivity, 250 m range gates.');
  let second=$('velocity-legend');
  if(!second){second=document.createElement('div');second.id='velocity-legend';second.className='radar-legend second-legend';document.querySelector('.map-workspace').append(second);}
  second.hidden=!state.compare||!state.visible.velocity;
  document.querySelector('.map-workspace').classList.toggle('comparison-legends',state.compare);
  if(state.compare){
    const vs=currentRadar().colorScales.velocity.stops,g=[];
    for(let i=0;i<vs.length-1;i++)g.push(vs[i][1]+' '+((vs[i][0]+100)/2)+'%',vs[i][1]+' '+((vs[i+1][0]+100)/2)+'%');
    g.push(vs.at(-1)[1]+' 100%');
    second.innerHTML='<div><span>RADIAL VELOCITY</span><span>kt</span></div><div class="colorbar" style="background:linear-gradient(to right,'+g.join(',')+')"></div><div class="legend-ticks">'+[-100,-50,0,50,100].map(n=>'<span style="left:'+((n+100)/2)+'%">'+n+'</span>').join('')+'</div>';
    second.title=velocityNote();
    $('radar-legend').hidden=!state.visible.reflectivity;
  }
}
function render() {
  if(!data)return;
  const car=roadPositionAt(roadTrack,state.t,state.offset), tornado=positionAt(centers,state.t,60000);
  const both=car&&tornado, distance=both?haversine(car,tornado):null;
  const route=roadSegmentsUntil(roadTrack,state.t,state.offset).map(s=>s.map(latlng));
  for(const [index,m] of maps.entries()){
    if(state.volume)continue;
    if(index===1&&!state.compare)continue;
    updateRadar(m,index);
    const site=currentRadar().siteLocation;
    if(site){m.radarSite.setLatLng([site.latitude,site.longitude]).setTooltipContent(currentRadar().site+' RADAR');m.radarSite.setPopupContent(sourcePopup(currentRadar().site+' radar',velocityNote(),state.radarSource==='air'?'https://arrc.ou.edu/data.html':'https://www.weather.gov/oun/'));
      setPresent(m.map,m.radarSite,state.visible.reflectivity||state.visible.velocity);
    }
    m.swath.setStyle({opacity:state.opacity.swath,fillOpacity:state.opacity.swath*.14});
    m.centerPath.setStyle({opacity:state.opacity.swath*.45});
    setPresent(m.map,m.swath,state.visible.swath);setPresent(m.map,m.centerPath,state.visible.swath);
    m.fullRoute.setStyle({opacity:state.opacity.track*.18});
    m.route.setLatLngs(route).setStyle({opacity:state.opacity.track});
    m.routeShadow.setLatLngs(route).setStyle({opacity:state.opacity.track*.75});
    for(const l of [m.fullRoute,m.routeShadow,m.route])setPresent(m.map,l,state.visible.track);
    if(car){
      m.car.setLatLng(latlng(car)).setOpacity(state.opacity.track);
      m.car.setPopupContent('<strong>Shane Motley / smotley</strong><small>'+esc(motionText(car))+'</small><small>'+esc(fmt(state.t)+' '+zoneLabel())+'</small><small>Camera clock unverified'+(state.offset?' · correction '+state.offset/60000+' min':' · UTC assumed')+'</small><small>'+car.lat.toFixed(5)+', '+car.lon.toFixed(5)+'</small><small>'+esc(speedText(car))+'</small>'+ (car.gapSeconds?'<small>'+car.gapSeconds+' seconds between GPS fixes</small>':'')+(Number.isFinite(car.snapDistanceMeters)?'<small>Road match: '+Math.round(car.snapDistanceMeters)+' m from source fix</small>':''));
      setPresent(m.map,m.car,state.visible.track);
      const body=m.car.getElement()?.querySelector('.vehicle-body');if(body)body.style.transform='rotate('+(car.headingDegrees??0)+'deg)';
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
  $('vehicle-speed').textContent=car?speedText(car):'No supported road position at this time';
  $('distance-caption').textContent=both?'Center separation · clock unverified':!car?'No supported road position in this interval':'No NWS center at this time';
  const formatted=fmt(state.t);
  $('current-time').innerHTML=esc(formatted).replace(/ (AM|PM)$/,' <small>$1</small>');
  const dateText=new Intl.DateTimeFormat('en-US',{timeZone:state.zone,month:'short',day:'numeric',year:'numeric'}).format(state.t).toUpperCase();
  $('time-date').firstChild.textContent=dateText+' ';
  $('timezone').textContent=zoneLabel()+' ▾';
  $('time-slider').value=(state.t-state.start)/1000;
  $('time-slider').style.setProperty('--progress',((state.t-state.start)/(state.end-state.start)*100)+'%');
  $('time-slider').setAttribute('aria-valuetext',fmt(state.t)+' '+zoneLabel());
  const products=['reflectivity','velocity'].filter(p=>state.visible[p]);
  const readings=products.map(p=>{
    const r=selectedRadar(p);
    return (p==='reflectivity'?'REF':'VEL')+' '+(r?fmt(r.t)+' · '+Math.floor(r.ageSeconds/60)+'m '+Math.floor(r.ageSeconds%60)+'s old':'no scan in range');
  });
  $('radar-status').textContent=readings.join(' / ')||'Both radar layers are off';
  if(state.volume){
    updateVolumeSurface(car);
    const volume=state.visible.reflectivity?selectedRadar('reflectivity')?.frame:null;
    volumeViewer?.setOpacity(state.opacity.reflectivity);
    volumeViewer?.setFrame(volume,currentRadar(),state.visible.reflectivity?undefined:'Reflectivity layer is hidden. Turn it on to view the volume.');
  }
  $('radar-title').textContent=state.radarSource==='air'?'AIR / ATMOSPHERIC IMAGING RADAR':state.visible.velocity?'KTLX / BASE VELOCITY NOT DEALIASED':'KTLX / ARCHIVED LEVEL II';
  const p=products[0],r=p?selectedRadar(p):null;
  $('radar-elevation').textContent=r?(state.volume?'3D':'0.5°'):'—';
  $('radar-elevation').title=r?'Nominal low tilt; encoded target '+r.frame[p+'Elevation']+'°. Radar times are '+(state.radarSource==='air'?'volume coverage midpoints; individual ray times unavailable.':'representative sweep midpoints.'):'';
  if(state.volume)$('radar-elevation').title='45 elevation slices, −2° to 20°. Heights in meters above mean sea level; no vertical exaggeration.';
  const interval=r?.frame.products?.[p]||r?.frame;
  const acquisition=state.radarSource==='air'&&interval?.scanStart&&interval?.scanEnd;
  $('radar-acquisition').hidden=!acquisition;
  $('radar-acquisition').textContent=acquisition?'Recorded '+fmt(date(interval.scanStart))+'–'+fmt(date(interval.scanEnd))+' '+zoneLabel()+' · midpoint clock':'';
  const noRadar=products.length&&!products.some(p=>selectedRadar(p));
  $('map-notice').hidden=!noRadar;
  if(noRadar)$('map-notice').textContent=state.radarSource==='air'?'No AIR image at this time. Choose AIR window to view its recorded period; use WSR-88D for the wider chase.':'No WSR-88D scan within the preceding 10 minutes. Choose Storm window for the bundled KTLX sequence.';
  updateLegend();updateRadarRails();updateRadarSourceUI();prefetchRadarImages();
}
function updateClosest() {
  best=closestRoadApproach(roadTrack,centers,state.offset);
  $('closest-value').textContent=best?(best.meters/MI).toFixed(1)+' mi · '+fmt(best.t,false):'No overlap';
  $('closest').disabled=!best;
  $('clock-status').textContent=state.offset?'Camera correction: '+(state.offset>0?'+':'')+(state.offset/60000).toFixed(1)+' min':'Camera clock: UTC assumed';
  $('clock-offset').value=state.offset/60000;
}
function setRange(range) {
  state.range=range;
  if(range==='storm'){state.start=STORM_START;state.end=STORM_END;}
  else if(range==='air'){const coverage=radarCoverage(state.volume?currentRadar():data.radars.air);state.start=coverage.start;state.end=coverage.end;}
  else{state.start=Math.min(track[0].t+state.offset,STORM_START,...spotters.map(s=>s.points[0].t));state.end=Math.max(track.at(-1).t+state.offset,STORM_END,...spotters.map(s=>s.points.at(-1).t));}
  if(range!=='air'){
    state.start=Math.floor(state.start/10000)*10000;state.end=Math.ceil(state.end/10000)*10000;
  }
  $('time-slider').min=0;$('time-slider').max=(state.end-state.start)/1000;
  $('range-storm').classList.toggle('selected',range==='storm');$('range-day').classList.toggle('selected',range==='day');$('range-air').classList.toggle('selected',range==='air');
  $('timeline-label').textContent=range==='storm'?'THE TORNADO WINDOW':range==='air'?'THE AIR WINDOW':'THE FULL CHASE';
  $('time-ticks').innerHTML=Array.from({length:5},(_,i)=>'<span>'+esc(fmt(state.start+(state.end-state.start)*i/4,false))+'</span>').join('');
  $('tornado-period').style.left=(Math.max(0,(centers[0].t-state.start)/(state.end-state.start))*100)+'%';
  $('tornado-period').style.width=(Math.max(0,Math.min(centers.at(-1).t,state.end)-Math.max(centers[0].t,state.start))/(state.end-state.start)*100)+'%';
  $('event-markers').replaceChildren();
  for(const event of data.timeline.events||[]){
    const t=date(event.time);if(t<state.start||t>state.end)continue;
    const b=document.createElement('button');b.style.left=((t-state.start)/(state.end-state.start)*100)+'%';
    b.title=fmt(t,false)+' · '+event.title;b.setAttribute('aria-label',b.title);
    b.addEventListener('click',()=>{setPlaying(false);setTime(t);toast(event.title+': '+(event.detail||event.description||''));});
    $('event-markers').append(b);
  }
  buildRadarRails();
  setTime(Math.min(state.end,Math.max(state.start,state.t)));
}
function setTime(t,snap=false){state.t=snap?snapTimelineTime(t,state.start,state.end):Math.min(state.end,Math.max(state.start,t));render();}
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
  setTime(state.t+direction*10000);
}
function stepScan(direction) {
  setPlaying(false);
  const product=state.visible.velocity&&!state.visible.reflectivity?'velocity':'reflectivity';
  const times=[...new Set(radarEvents.filter(e=>state.compare?state.visible[e.product]:e.product===product).map(e=>e.t))].sort((a,b)=>a-b);
  const next=direction>0?times.find(t=>t>state.t+1):times.filter(t=>t<state.t-1).at(-1);
  if(next===undefined){toast('No '+(direction>0?'later':'earlier')+' '+currentRadar().site+' image in this archive.');return;}
  if(next<state.start||next>state.end)setRange(state.radarSource==='air'?'air':next<STORM_START||next>STORM_END?'day':'storm');
  setTime(next);
}
function buildRadarRails() {
  for(const product of ['reflectivity','velocity']){
    const rail=$('scan-'+product);rail.replaceChildren();
    for(const event of radarEvents.filter(e=>e.product===product&&e.t>=state.start&&e.t<=state.end)){
      const button=document.createElement('button');button.className='scan-tick';button.dataset.eventId=event.id;
      button.style.left=((event.t-state.start)/(state.end-state.start)*100)+'%';
      if(state.radarSource==='air')button.style.width='min(12px,'+(7/(state.end-state.start)*100000)+'%)';
      button.title=currentRadar().site+' '+(product==='reflectivity'?'reflectivity':'velocity')+' scan · '+fmt(event.t)+' '+zoneLabel()+' · click to jump';
      button.setAttribute('aria-label',button.title);
      button.addEventListener('click',()=>{
        setPlaying(false);state.visible[product]=true;$('layer-'+product).checked=true;
        if(!state.compare){const other=product==='reflectivity'?'velocity':'reflectivity';state.visible[other]=false;$('layer-'+other).checked=false;}
        setTime(event.t);toast('New '+(product==='reflectivity'?'reflectivity':'velocity')+' scan at '+fmt(event.t)+' '+zoneLabel()+'. '+(state.radarSource==='air'?'Volume coverage midpoint':'Sweep midpoint')+'; vehicle positions are inferred.');
      });
      rail.append(button);
    }
  }
}
function updateRadarRails() {
  const progress=(state.t-state.start)/(state.end-state.start)*100;
  $('radar-rails').style.setProperty('--scan-progress',progress+'%');
  for(const product of ['reflectivity','velocity']){
    const unavailable=currentRadar().unavailableProducts?.[product];
    $('scan-'+product).closest('.scan-row').classList.toggle('unavailable',!!unavailable);
    if(unavailable){
      $('scan-'+product+'-time').textContent='Unavailable';
      $('scan-'+product+'-time').title=unavailable.reason;
      continue;
    }
    const selection=selectedRadar(product);
    const active=selection?radarEvents.find(e=>e.product===product&&e.t===selection.t):null;
    for(const b of $('scan-'+product).children){
      const selected=b.dataset.eventId===active?.id;b.classList.toggle('active',selected);b.setAttribute('aria-pressed',String(selected));
    }
    const next=radarEvents.find(e=>e.product===product&&e.t>state.t);
    $('scan-'+product+'-time').textContent=active?fmt(active.t):'—';
    $('scan-'+product+'-time').title=(active?'Latest scan: '+fmt(active.t)+' '+zoneLabel():'No preceding image')+(next?' · Next: '+fmt(next.t)+' '+zoneLabel():' · No later scan');
  }
}
function jumpSpotter(s) {
  setPlaying(false);
  exitVolumeMode();for(const m of maps)m.map.invalidateSize({pan:false});
  state.selectedSpotter=s.id;
  let p=spotterPosition(s,state.t);
  if(!p){
    p=s.points.reduce((a,b)=>Math.abs(b.t-state.t)<Math.abs(a.t-state.t)?b:a);
    if(p.t<state.start||p.t>state.end)setRange('day');
    // Survey observations can precede the camera day; expand only to the selected evidence.
    if(p.t<state.start||p.t>state.end){state.start=Math.min(state.start,p.t);state.end=Math.max(state.end,p.t);$('time-slider').min=0;$('time-slider').max=(state.end-state.start)/1000;}
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
  spotters.forEach((s,i)=>{
    const card=document.createElement('article');card.className='person-card';card.style.setProperty('--chaser-color',chaserColor(s));
    const initials=s.name.split(/[ ,]+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('');
    card.innerHTML='<div class="person-top"><span class="person-avatar" style="color:'+chaserColor(s)+'">'+esc(initials)+'</span><div class="person-info"><strong><i class="person-color"></i>'+esc(s.name)+'</strong><span>'+s.points.length+' positions · '+(s.imported?'imported, unverified':'survey camera')+'</span></div><button class="person-go" aria-label="Locate '+esc(s.name)+'">↗</button></div><div class="person-links">'+link(s.sourceUrl,'Source')+link(s.surveyVideoUrl,'Survey film')+(s.videos||[]).map(id=>{const v=data.videos.videos.find(v=>v.id===id);return v?link(v.url,v.playbackStatus==='private'?'YouTube (private)':'YouTube'):'';}).join('')+'</div>';
    card.querySelector('button').addEventListener('click',()=>jumpSpotter(s));$('people-list').append(card);
  });
  $('featured-chasers').replaceChildren();
  for(const [id,featured] of Object.entries(featuredChasers)){
    const s=spotters.find(s=>s.id===id);if(!s)continue;
    const b=document.createElement('button');b.innerHTML='<i style="background:'+featured.color+'"></i>'+esc(featured.name);b.title='Locate '+featured.name;b.addEventListener('click',()=>jumpSpotter(s));$('featured-chasers').append(b);
  }
  $('spotter-note').innerHTML='<strong>These are survey camera positions.</strong><p>'+esc(data.spotters.sourceNotes)+'</p><p>All published tracks are matched to connected roads where possible. Motion follows the inferred route at its interval-average speed. Gaps over two minutes, failed matches, and flagged jumps stay empty; imported tracks show original fixes only.</p>';
}
function buildVideos() {
  $('video-list').replaceChildren();
  data.videos.videos.forEach((v,i)=>{
    const card=document.createElement('article');card.className='video-card';
    card.innerHTML='<a class="video-cover" href="'+esc(safeURL(v.url))+'" target="_blank" rel="noopener noreferrer" aria-label="'+(v.playbackStatus==='private'?'View original listing: ':'Watch ')+esc(v.title)+'"><span class="film-label">31 MAY 2013 / ORIGINAL FOOTAGE</span><span class="video-play">'+(v.playbackStatus==='private'?'▣':'▶')+'</span><span class="film-number">'+String(i+1).padStart(2,'0')+'</span></a><div class="video-info"><h3>'+esc(v.title)+'</h3><div class="creator">'+esc(v.creator)+'</div><p>'+esc(v.description)+'</p><div class="video-foot"><span>'+(v.playbackStatus==='private'?'PRIVATE VIDEO':v.time?'TIMED LOCATION':'TIMING NOT REGISTERED')+'</span>'+link(v.url,v.playbackStatus==='private'?'Original listing':'Watch original')+'</div></div>';
    $('video-list').append(card);
  });
}
function bindControls() {
  document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.tab)));
  for(const layer of Object.keys(state.visible)){
    $('layer-'+layer).addEventListener('change',e=>{
      if(currentRadar().unavailableProducts?.[layer]){e.target.checked=false;return;}
      state.visible[layer]=e.target.checked;
      if(!state.compare&&e.target.checked&&['reflectivity','velocity'].includes(layer)){
        const other=layer==='reflectivity'?'velocity':'reflectivity';state.visible[other]=false;$('layer-'+other).checked=false;
      }
      render();
    });
    $('opacity-'+layer).addEventListener('input',e=>{state.opacity[layer]=Number(e.target.value)/100;const output=$('opacity-'+layer+'-value');if(output)output.textContent=e.target.value+'%';render();});
  }
  $('source-ktlx').addEventListener('click',()=>{volumeLoadVersion++;setRadarSource('ktlx');});$('source-air').addEventListener('click',()=>{volumeLoadVersion++;setRadarSource('air');});
  $('air-info').addEventListener('click',()=>$('air-dialog').showModal());
  $('scan-back').addEventListener('click',()=>stepScan(-1));$('scan-next').addEventListener('click',()=>stepScan(1));
  $('view-single').addEventListener('click',()=>{volumeLoadVersion++;toggleCompare(false);});$('view-compare').addEventListener('click',()=>{volumeLoadVersion++;toggleCompare(true);});
  $('view-volume').addEventListener('click',enterVolumeMode);
  $('view-volume').disabled=false;
  $('volume-reset').addEventListener('click',()=>volumeViewer?.resetView());
  $('volume-surface').addEventListener('change',e=>{state.volumeSurface=e.target.checked;render();});
  $('volume-focus').addEventListener('click',()=>volumeViewer?.focusMarker('smotley'));
  $('volume-threshold').addEventListener('input',e=>{
    $('volume-threshold-value').textContent=e.target.value+' dBZ';volumeViewer?.setThreshold(Number(e.target.value));
  });
  $('basemap').addEventListener('change',e=>{state.basemap=e.target.value;setBasemap();});
  $('follow').addEventListener('click',()=>{state.follow=!state.follow;$('follow').setAttribute('aria-pressed',String(state.follow));render();});
  $('fit-route').addEventListener('click',()=>{state.follow=false;$('follow').setAttribute('aria-pressed','false');maps[0].map.fitBounds(track.map(latlng),{padding:[45,65]});});
  $('fit-storm').addEventListener('click',()=>{state.follow=false;$('follow').setAttribute('aria-pressed','false');maps[0].map.setView([35.455,-97.985],11);});
  $('play').addEventListener('click',()=>setPlaying(!state.playing));$('step-back').addEventListener('click',()=>step(-1));$('step-forward').addEventListener('click',()=>step(1));
  $('speed').addEventListener('change',e=>state.speed=Number(e.target.value));
  $('time-slider').addEventListener('input',e=>{setPlaying(false);setTime(state.start+Number(e.target.value)*1000,true);});
  $('time-slider').addEventListener('keydown',e=>{
    // AIR can end between ten-second ticks; keep both exact bounds reachable.
    if(e.key==='Home'||e.key==='End'){
      e.preventDefault();setPlaying(false);setTime(e.key==='Home'?state.start:state.end);
    }
  });
  $('range-storm').addEventListener('click',()=>setRange('storm'));$('range-day').addEventListener('click',()=>setRange('day'));$('range-air').addEventListener('click',()=>{setPlaying(false);setRange('air');if(!selectedRadar('reflectivity'))setTime(radarCoverage(data.radars.air).start);});
  $('timezone').addEventListener('click',()=>{state.zone=state.zone==='UTC'?'America/Chicago':'UTC';updateClosest();setRange(state.range);});
  $('closest').addEventListener('click',()=>{if(!best)return;setPlaying(false);exitVolumeMode();for(const m of maps)m.map.invalidateSize({pan:false});if(best.t<state.start||best.t>state.end)setRange('day');setTime(best.t);maps[0].map.fitBounds([latlng(best.car),latlng(best.tornado)],{padding:[90,140],maxZoom:13});toast('Estimated center separation: '+(best.meters/MI).toFixed(1)+' mi at '+fmt(best.t)+' '+zoneLabel()+'. Road-matched vehicle and estimated NWS center; camera clock unverified.');});
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
      spotters.push(...imported);buildPeople();render();$('import-status').textContent='Added '+imported.length+' tracks to this session. Imported identity and positions are unverified. Original observations only until road matching is prepared.';
    }catch(error){$('import-status').textContent=error.message;}finally{e.target.value='';}
  });
  document.addEventListener('keydown',e=>{
    if(/INPUT|SELECT|TEXTAREA|BUTTON/.test(e.target.tagName)||document.querySelector('dialog[open]'))return;
    if(e.target.closest('#volume-canvas'))return;
    if(e.code==='Space'){e.preventDefault();setPlaying(!state.playing);}
    if(e.target.closest('.leaflet-container'))return;
    if(e.key==='ArrowRight'){e.preventDefault();step(1);}
    if(e.key==='ArrowLeft'){e.preventDefault();step(-1);}
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden)setPlaying(false);});
}
async function init() {
  try {
    if(!window.L)throw new Error('The bundled map library could not load. Start the local server rather than opening index.html directly.');
    const values=await Promise.all(['GPS.json','data/tornado.geojson','data/tornado-timeline.json','data/radar/manifest.json','data/spotters.json','data/videos.json','data/roads.geojson','data/road-routes.json','data/air/manifest.json'].map(loadJSON));
    data={gps:values[0],tornado:values[1],timeline:values[2],radars:{ktlx:values[3],air:values[8]},spotters:values[4],videos:values[5],roads:values[6],routes:values[7]};
    track=normalizePoints(data.gps.data);centers=normalizePoints(data.timeline.points);
    roadTracks=Object.fromEntries(Object.entries(data.routes.tracks).map(([id,t])=>[id,prepareRoadTrack(t)]));roadTrack=roadTracks.smotley;
    radarEvents=currentRadarEvents();
    spotters=data.spotters.spotters.map(s=>({...s,name:featuredChasers[s.id]?.name||s.name,points:normalizePoints(s.points)}));
    maps=[makeMap('map'),makeMap('map-compare',true)];
    setBasemap();buildPeople();buildVideos();bindControls();updateClosest();setRange('storm');
    $('track-summary').textContent=track.length+' GPS fixes · inferred road routes';
    const sources=[
      {label:'Original camera GPS · smotley',url:'https://github.com/smmotley/El_Reno/blob/master/GPS.json'},
      {label:'NWS Norman · May 31 event and official tornado survey',url:data.timeline.sourcePageUrl},
      {label:'NWS · original timed center positions (KMZ)',url:data.timeline.sourceUrl},
      {label:'OpenStreetMap · locally stored current road network',url:'https://www.openstreetmap.org/copyright'},
      {label:'Mapzen / USGS · public terrain heights for the 3D surface',url:'https://registry.opendata.aws/terrain-tiles/'},
      ...(data.radars.ktlx.sources||[]),...(data.radars.air.sources||[]),...(data.spotters.sources||[])
    ];
    $('source-list').innerHTML=sources.map(s=>link(s.url,s.label||s.title||s.name||s.url)).join('');
    // Prefetch a bounded neighborhood; AIR's larger images must not all decode at once.
    prefetchRadarImages();
  } catch(error) {
    $('map-notice').hidden=false;$('map-notice').textContent=error.message;
    $('radar-status').textContent='Unable to load reconstruction';$('closest-value').textContent='Unavailable';$('closest').disabled=true;
    console.error(error);
  }
}
init();
