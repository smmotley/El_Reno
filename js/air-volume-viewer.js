/**
 * Measured AIR reflectivity rendered as a metric Cartesian volume. Import is
 * safe without a DOM; browser resources are acquired only by the constructor.
 * Manifest bounds are meters; rendering and surface annotations use kilometers
 * east/north/MSL on every axis, with no vertical exaggeration.
 */
const VERTEX = `#version 300 es
in vec2 position;
void main(){gl_Position=vec4(position,0.0,1.0);}`;
const FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler3D volume;
uniform sampler2D palette;
uniform sampler2D surfaceColor,surfaceDepth;
uniform vec3 boxMin,boxMax,eye,forward,right,up,cellSize;
uniform vec2 resolution,clipRange;
uniform float aspect,tanHalfFov,threshold,opacity,valueScale,valueOffset,indexOffset;
uniform bool hasVolume,hasSurface;
out vec4 color;
vec2 intersectBox(vec3 direction){
  vec3 safeDirection=mix(vec3(0.0000001),direction,greaterThan(abs(direction),vec3(0.0000001)));
  vec3 a=(boxMin-eye)/safeDirection,b=(boxMax-eye)/safeDirection;
  vec3 nearV=min(a,b),farV=max(a,b);
  return vec2(max(max(nearV.x,nearV.y),nearV.z),min(min(farV.x,farV.y),farV.z));
}
void main(){
  vec2 screen=gl_FragCoord.xy/resolution*2.0-1.0;
  vec3 direction=normalize(forward+right*screen.x*aspect*tanHalfFov+up*screen.y*tanHalfFov);
  vec3 background=mix(vec3(0.025,0.045,0.043),vec3(0.070,0.105,0.094),clamp(screen.y*.4+.5,0.0,1.0));
  // This is a labeled MSL reference plane, not invented terrain or ground data.
  float planeT=(boxMin.z-eye.z)/direction.z;
  if(direction.z<-.00001&&planeT>0.0){
    vec3 p=eye+direction*planeT;
    if(all(greaterThanEqual(p.xy,boxMin.xy))&&all(lessThanEqual(p.xy,boxMax.xy))){
      vec2 gridDistance=abs(fract(p.xy/5.0+.5)-.5)*5.0;
      float line=1.0-smoothstep(.025,.085,min(gridDistance.x,gridDistance.y));
      background=mix(vec3(.070,.105,.095),vec3(.17,.23,.20),line*.55);
    }
  }
  float groundT=1.0e20;
  if(hasSurface){
    vec2 uv=gl_FragCoord.xy/resolution;
    float depth=texture(surfaceDepth,uv).r;
    if(depth<1.0){
      float ndc=depth*2.0-1.0;
      float forwardDepth=2.0*clipRange.x*clipRange.y/(clipRange.y+clipRange.x-ndc*(clipRange.y-clipRange.x));
      groundT=forwardDepth/dot(direction,forward);
      background=texture(surfaceColor,uv).rgb;
    }
  }
  vec4 accumulated=vec4(0.0);
  vec2 hit=intersectBox(direction);
  float start=max(hit.x,0.0),span=min(hit.y,groundT)-start;
  if(hasVolume&&span>0.0&&opacity>0.0){
    // Distances are kilometers on all axes. The integration step is physical,
    // not normalized independently by the unequal axis lengths or voxel counts.
    float stepKm=max(min(min(cellSize.x,cellSize.y),cellSize.z)*.8,span/768.0);
    for(int i=0;i<768;i++){
      float traveled=float(i)*stepKm;
      if(traveled>=span||accumulated.a>.985)break;
      float integrationLength=min(stepKm,span-traveled);
      vec3 p=eye+direction*(start+traveled+integrationLength*.5);
      vec3 uvw=clamp((p-boxMin)/(boxMax-boxMin),vec3(0.0),vec3(1.0));
      // NEAREST sampling preserves explicit missing voxels and sector edges.
      // Never blend q=0 into a seemingly measured reflectivity value.
      int q=int(floor(texture(volume,uvw).r*255.0+.5));
      if(q==0)continue;
      float dbz=(float(q)-indexOffset)*valueScale+valueOffset;
      if(dbz<threshold)continue;
      vec3 rgb=texelFetch(palette,ivec2(q,0),0).rgb;
      float sigma=opacity*(.08+.75*clamp((dbz-threshold)/45.0,0.0,1.0));
      float alpha=1.0-exp(-sigma*integrationLength);
      accumulated.rgb+=(1.0-accumulated.a)*alpha*rgb;
      accumulated.a+=(1.0-accumulated.a)*alpha;
    }
  }
  color=vec4(accumulated.rgb+(1.0-accumulated.a)*background,1.0);
}`;
const TERRAIN_VERTEX = `#version 300 es
in vec3 position;
uniform vec3 eye,forward,right,up;
uniform vec2 clipRange;
uniform float aspect,tanHalfFov;
out vec3 worldPosition;
void main(){
  vec3 relative=position-eye;
  float depth=dot(relative,forward);
  float clipZ=(clipRange.y+clipRange.x)/(clipRange.y-clipRange.x)*depth-2.0*clipRange.y*clipRange.x/(clipRange.y-clipRange.x);
  gl_Position=vec4(dot(relative,right)/(aspect*tanHalfFov),dot(relative,up)/tanHalfFov,clipZ,depth);
  worldPosition=position;
}`;
const TERRAIN_FRAGMENT = `#version 300 es
precision highp float;
in vec3 worldPosition;
out vec4 color;
void main(){
  vec3 normal=normalize(cross(dFdx(worldPosition),dFdy(worldPosition)));
  if(normal.z<0.0)normal=-normal;
  float shade=.66+.34*max(0.0,dot(normal,normalize(vec3(-.4,-.5,1.0))));
  vec2 gridDistance=abs(fract(worldPosition.xy/5.0+.5)-.5)*5.0;
  float line=1.0-smoothstep(.025,.075,min(gridDistance.x,gridDistance.y));
  // Neutral relief shading and metric grid, not inferred land cover.
  color=vec4(mix(vec3(.19,.255,.215)*shade,vec3(.34,.40,.33),line*.32),1.0);
}`;
const DEFAULT_STOPS = [[-10,'#334c68'],[0,'#487aa0'],[10,'#42b66b'],[20,'#20b83b'],[30,'#b6d938'],[40,'#ffd941'],[50,'#ee7834'],[60,'#d52f40'],[70,'#ba66d4'],[80,'#f0d7f4']];
const clamp = (n,a,b) => Math.min(b,Math.max(a,n));
const DEG = Math.PI/180;
const CAMERA_LIMITS = {minDistanceKm:2,maxDistanceRatio:3.5,minTiltDegrees:5,maxTiltDegrees:89,clearanceKm:.05};
const subtract = (a,b) => a.map((v,i)=>v-b[i]);
const dot = (a,b) => a.reduce((sum,v,i)=>sum+v*b[i],0);
const normalize = a => {const length=Math.hypot(...a);return a.map(v=>v/length);};
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

function gridContract(manifest) {
  const v=manifest?.volume, dims=v?.dimensions;
  if(!Array.isArray(dims)||dims.length!==3||dims.some(n=>!Number.isInteger(n)||n<2||n>1024))throw new Error('The radar volume dimensions are invalid.');
  const count=dims.reduce((a,b)=>a*b,1);
  if(count>64*1024*1024)throw new Error('This radar volume is too large for the viewer.');
  if(v.datatype!=='uint8'||v.missingValue!==0||v.sampling!=='cell-centers'||v.axisOrder!=='x-fastest, then y, then z')throw new Error('The radar volume encoding is unsupported.');
  const bounds=['x','y','z'].map(axis=>v.bounds?.[axis]);
  if(bounds.some(b=>!Array.isArray(b)||b.length!==2||!b.every(Number.isFinite)||b[0]>=b[1]))throw new Error('The radar volume bounds are invalid.');
  const decode=v.decode;
  if(!decode||![decode.scale,decode.offset,decode.indexOffset].every(Number.isFinite)||decode.scale<=0)throw new Error('The reflectivity scale is invalid.');
  return {dimensions:[...dims],count,min:bounds.map(b=>b[0]/1000),max:bounds.map(b=>b[1]/1000),decode:{...decode},compression:v.compression,
    key:JSON.stringify([dims,bounds,decode,v.compression])};
}

function compile(gl,type,source) {
  const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);
  if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) {const info=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw new Error(info||'Radar shader compilation failed.');}
  return shader;
}

/**
 * onStatus receives {state:'loading'|'ready'|'empty'|'error',message,frameTime,
 * supported}. setFrame resolves true only when the requested frame is uploaded.
 * null frames clear immediately; its optional third argument explains the empty
 * state. Rotation persists when files change. The
 * renderer retains at most three decoded arrays and one GPU volume texture.
 */
export class AirVolumeViewer {
  constructor(container,{onStatus,onMarkerSelect,onViewChange,onLabelsChange}={}) {
    if(!container?.appendChild)throw new TypeError('A browser container is required for the radar viewer.');
    this.container=container;this.onStatus=onStatus;this.onMarkerSelect=onMarkerSelect;this.onViewChange=onViewChange;this.onLabelsChange=onLabelsChange;this.supported=false;
    this.active=true;this.destroyed=false;this.opacity=.72;this.threshold=30;
    this._cache=new Map();this._pointers=new Map();this._listeners=[];this._generation=0;
    this._ready=false;this._key=null;this._pending=null;this._desired=null;this._raf=0;this._empty=false;this._emptyMessage=null;
    this._surface=null;this._terrain=null;this._terrainCount=0;this._roads=[];this._markers=[];this._markerHits=[];
    this._hiddenLabels=new Set();this._labelButtons=new Map();this._axisLabelsVisible=true;this._lastViewState=null;this._lastLabelsState=null;
    this.yaw=0;this.pitch=.4;this.zoom=1;this._pan=[0,0,0];this._radarOffset=[0,0];
    this._oldPosition=container.style.position;
    if(getComputedStyle(container).position==='static')container.style.position='relative';
    this.element=document.createElement('div');
    Object.assign(this.element.style,{position:'absolute',inset:'0',overflow:'hidden',background:'#0b1512'});
    this.canvas=document.createElement('canvas');this.canvas.tabIndex=0;
    this.canvas.setAttribute('role','img');
    this.canvas.setAttribute('aria-label','Interactive measured radar volume. Drag or use arrow keys to rotate. Shift-drag, Shift-arrow, or two fingers pan. Pinch, scroll, or use plus and minus to zoom. Home resets the view.');
    Object.assign(this.canvas.style,{display:'block',width:'100%',height:'100%',touchAction:'none',cursor:'grab',outlineOffset:'-3px'});
    this.labels=document.createElement('canvas');this.labels.setAttribute('aria-hidden','true');
    Object.assign(this.labels.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none'});
    this.labelControls=document.createElement('div');
    Object.assign(this.labelControls.style,{position:'absolute',inset:'0',pointerEvents:'none'});
    this.message=document.createElement('div');
    Object.assign(this.message.style,{position:'absolute',inset:'40% 14% auto',textAlign:'center',font:'13px/1.6 system-ui,sans-serif',color:'#d3dfcc',pointerEvents:'none',textShadow:'0 1px 4px #000'});
    this.element.append(this.canvas,this.labels,this.labelControls,this.message);container.append(this.element);
    try {
      this.gl=this.canvas.getContext('webgl2',{alpha:false,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:false});
      if(!this.gl)throw new Error('WebGL 2 is unavailable.');
      this._initializeGL();this.supported=true;
    } catch(error) {
      this._status('error','Interactive 3D is unavailable in this browser. The 2D radar map remains available.',null,error);
    }
    this._bindInteraction();
    this._listen(this.canvas,'webglcontextlost',event=>{
      event.preventDefault();this.supported=false;this._ready=false;this._generation++;this._controller?.abort();
      this._status('error','The 3D graphics connection was lost. Use the 2D map or wait for recovery.');
    });
    this._listen(this.canvas,'webglcontextrestored',()=>{
      if(this.destroyed)return;
      try {this._initializeGL();this.supported=true;this._key=null;this._empty=false;if(this._desired)this.setFrame(this._desired.frame,this._desired.manifest,this._desired.emptyMessage);}
      catch(error){this._status('error','The 3D graphics connection could not recover.',null,error);}
    });
    if(typeof ResizeObserver!=='undefined'){this._observer=new ResizeObserver(()=>this.resize());this._observer.observe(container);}
    else this._listen(window,'resize',()=>this.resize());
    this.resize();
    if(this.supported)this._status('empty','Choose a time with an AIR radar volume.');
  }

  _initializeGL() {
    const gl=this.gl;
    const vertex=compile(gl,gl.VERTEX_SHADER,VERTEX),fragment=compile(gl,gl.FRAGMENT_SHADER,FRAGMENT);
    this._program=gl.createProgram();gl.attachShader(this._program,vertex);gl.attachShader(this._program,fragment);gl.linkProgram(this._program);
    gl.deleteShader(vertex);gl.deleteShader(fragment);
    if(!gl.getProgramParameter(this._program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(this._program));
    this._uniforms={};
    for(const name of ['volume','palette','surfaceColor','surfaceDepth','boxMin','boxMax','eye','forward','right','up','cellSize','resolution','clipRange','aspect','tanHalfFov','threshold','opacity','valueScale','valueOffset','indexOffset','hasVolume','hasSurface'])this._uniforms[name]=gl.getUniformLocation(this._program,name);
    this._vao=gl.createVertexArray();gl.bindVertexArray(this._vao);
    this._buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this._buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
    const location=gl.getAttribLocation(this._program,'position');gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,2,gl.FLOAT,false,0,0);
    this._volumeTexture=gl.createTexture();gl.bindTexture(gl.TEXTURE_3D,this._volumeTexture);
    for(const parameter of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_3D,parameter,gl.NEAREST);
    for(const parameter of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T,gl.TEXTURE_WRAP_R])gl.texParameteri(gl.TEXTURE_3D,parameter,gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
    gl.texImage3D(gl.TEXTURE_3D,0,gl.R8,2,2,2,0,gl.RED,gl.UNSIGNED_BYTE,new Uint8Array(8));
    this._paletteTexture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this._paletteTexture);
    for(const parameter of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,parameter,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,256,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(1024));
    gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);
    this._initializeSurfaceGL();
    if(this._terrain)this._uploadTerrain(this._terrain);
  }

  _initializeSurfaceGL() {
    const gl=this.gl;
    const vertex=compile(gl,gl.VERTEX_SHADER,TERRAIN_VERTEX),fragment=compile(gl,gl.FRAGMENT_SHADER,TERRAIN_FRAGMENT);
    this._terrainProgram=gl.createProgram();gl.attachShader(this._terrainProgram,vertex);gl.attachShader(this._terrainProgram,fragment);gl.linkProgram(this._terrainProgram);
    gl.deleteShader(vertex);gl.deleteShader(fragment);
    if(!gl.getProgramParameter(this._terrainProgram,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(this._terrainProgram));
    this._terrainUniforms={};
    for(const name of ['eye','forward','right','up','clipRange','aspect','tanHalfFov'])this._terrainUniforms[name]=gl.getUniformLocation(this._terrainProgram,name);
    this._terrainVao=gl.createVertexArray();gl.bindVertexArray(this._terrainVao);
    this._terrainBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this._terrainBuffer);
    const location=gl.getAttribLocation(this._terrainProgram,'position');gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,3,gl.FLOAT,false,0,0);
    this._terrainIndexBuffer=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this._terrainIndexBuffer);
    this._surfaceFramebuffer=gl.createFramebuffer();
    this._surfaceColor=gl.createTexture();this._surfaceDepth=gl.createTexture();
    for(const texture of [this._surfaceColor,this._surfaceDepth]){
      gl.bindTexture(gl.TEXTURE_2D,texture);
      for(const p of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,p,gl.NEAREST);
      for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,p,gl.CLAMP_TO_EDGE);
    }
    this._surfaceWidth=0;this._surfaceHeight=0;this._resizeSurfaceTarget(1,1);
  }

  _resizeSurfaceTarget(width,height) {
    if(this._surfaceWidth===width&&this._surfaceHeight===height)return;
    const gl=this.gl;
    gl.bindTexture(gl.TEXTURE_2D,this._surfaceColor);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.bindTexture(gl.TEXTURE_2D,this._surfaceDepth);gl.texImage2D(gl.TEXTURE_2D,0,gl.DEPTH_COMPONENT24,width,height,0,gl.DEPTH_COMPONENT,gl.UNSIGNED_INT,null);
    gl.bindFramebuffer(gl.FRAMEBUFFER,this._surfaceFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this._surfaceColor,0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,this._surfaceDepth,0);
    const complete=gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    if(!complete)throw new Error('The device cannot render the terrain context.');
    this._surfaceWidth=width;this._surfaceHeight=height;
  }

  _uploadTerrain(terrain) {
    const gl=this.gl,[nx,ny]=terrain.dimensions,[x0,x1]=terrain.bounds.x,[y0,y1]=terrain.bounds.y;
    const vertices=new Float32Array(nx*ny*3),valid=new Uint8Array(nx*ny);
    for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
      const index=j*nx+i,z=terrain.heights[index];
      vertices[index*3]=x0+i/(nx-1)*(x1-x0);vertices[index*3+1]=y0+j/(ny-1)*(y1-y0);
      if(typeof z==='number'&&Number.isFinite(z)){vertices[index*3+2]=z;valid[index]=1;}
    }
    const indices=new Uint32Array((nx-1)*(ny-1)*6);let count=0;
    for(let j=0;j<ny-1;j++)for(let i=0;i<nx-1;i++){
      const a=j*nx+i,b=a+1,c=a+nx+1,d=a+nx;
      if(valid[a]&&valid[b]&&valid[c]){indices[count++]=a;indices[count++]=b;indices[count++]=c;}
      if(valid[a]&&valid[c]&&valid[d]){indices[count++]=a;indices[count++]=c;indices[count++]=d;}
    }
    gl.bindVertexArray(this._terrainVao);
    gl.bindBuffer(gl.ARRAY_BUFFER,this._terrainBuffer);gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this._terrainIndexBuffer);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,indices.subarray(0,count),gl.STATIC_DRAW);
    this._terrainCount=count;
  }

  /** Stable context in radar-local kilometers: node-sampled MSL terrain, roads. */
  setSurface(surface) {
    if(this.destroyed||surface===this._surface)return;
    const terrain=surface?.terrain??null;
    if(terrain){
      const dimensions=terrain.dimensions,bounds=terrain.bounds;
      if(terrain.sampling!=='nodes'||!Array.isArray(dimensions)||dimensions.length!==2||dimensions.some(n=>!Number.isInteger(n)||n<2||n>1024)||dimensions[0]*dimensions[1]>1024*1024||terrain.heights?.length!==dimensions[0]*dimensions[1]||['x','y'].some(axis=>!Array.isArray(bounds?.[axis])||bounds[axis].length!==2||!bounds[axis].every(Number.isFinite)||bounds[axis][0]>=bounds[axis][1]))throw new TypeError('The terrain must be a node grid in radar-local kilometers.');
    }
    this._surface=surface??null;
    this._roads=(surface?.roads??[]).filter(road=>Array.isArray(road.points)&&road.points.length>=2);
    if(terrain!==this._terrain){this._terrain=terrain;this._terrainCount=0;if(terrain&&this.supported)this._uploadTerrain(terrain);}
    this._viewChanged();
  }

  /** Foreground annotations; x east, y north, z MSL, all in kilometers. */
  setMarkers(markers) {
    if(this.destroyed)return;
    this._markers=(Array.isArray(markers)?markers:[]).filter(m=>m&&[m.x,m.y,m.z].every(Number.isFinite)).map(m=>({...m,opacity:Number.isFinite(m.opacity)?clamp(m.opacity,0,1):1,priority:Number.isFinite(m.priority)?m.priority:m.kind==='suv'?3:1,color:/^#[a-f0-9]{6}$/i.test(m.color??'')?m.color:m.kind==='suv'?'#a4ada9':'#8eb5bc'}));
    this._emitLabelsChange();
    this._schedule();
  }

  _drawTerrain(camera) {
    if(!this._terrainCount)return false;
    const gl=this.gl,u=this._terrainUniforms;
    this._resizeSurfaceTarget(this.canvas.width,this.canvas.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER,this._surfaceFramebuffer);gl.viewport(0,0,this.canvas.width,this.canvas.height);
    gl.clearColor(0,0,0,0);gl.clearDepth(1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LESS);gl.useProgram(this._terrainProgram);gl.bindVertexArray(this._terrainVao);
    for(const name of ['eye','forward','right','up'])gl.uniform3fv(u[name],camera[name]);
    gl.uniform2fv(u.clipRange,camera.clipRange);gl.uniform1f(u.aspect,camera.aspect);gl.uniform1f(u.tanHalfFov,camera.tanHalfFov);
    gl.drawElements(gl.TRIANGLES,this._terrainCount,gl.UNSIGNED_INT,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.disable(gl.DEPTH_TEST);return true;
  }

  _listen(target,type,handler,options) {target.addEventListener(type,handler,options);this._listeners.push(()=>target.removeEventListener(type,handler,options));}
  _status(state,message,frame=null,error=null) {
    this.message.textContent=state==='ready'?'':message;
    this.onStatus?.({state,message,frameTime:frame?.time??null,supported:this.supported,...(error?{error}:{} )});
  }

  _bindInteraction() {
    this._listen(this.canvas,'pointerdown',event=>{
      if(event.pointerType==='mouse'&&event.button!==0)return;
      this.canvas.focus({preventScroll:true});this.canvas.setPointerCapture(event.pointerId);
      this._pointers.set(event.pointerId,[event.clientX,event.clientY]);this.canvas.style.cursor='grabbing';
      this._clickStart=this._pointers.size===1?{id:event.pointerId,x:event.clientX,y:event.clientY}:null;
      event.preventDefault();
    });
    this._listen(this.canvas,'pointermove',event=>{
      if(!this._pointers.has(event.pointerId)){const hit=this._markerAtEvent(event);this.canvas.title=hit?.marker.label??'';return;}
      if(this._clickStart&&Math.hypot(event.clientX-this._clickStart.x,event.clientY-this._clickStart.y)>5)this._clickStart=null;
      const before=[...this._pointers.values()],old=this._pointers.get(event.pointerId),next=[event.clientX,event.clientY];
      this._pointers.set(event.pointerId,next);
      if(this._pointers.size===1){
        if(event.shiftKey)this._panPixels(next[0]-old[0],next[1]-old[1]);
        else{this.yaw-=(next[0]-old[0])*.007;this.pitch+=(next[1]-old[1])*.007;}
      }
      else {
        const after=[...this._pointers.values()];
        const previousDistance=Math.hypot(before[0][0]-before[1][0],before[0][1]-before[1][1]);
        const nextDistance=Math.hypot(after[0][0]-after[1][0],after[0][1]-after[1][1]);
        if(previousDistance>5&&nextDistance>5)this.zoom*=previousDistance/nextDistance;
        this._panPixels((after[0][0]+after[1][0]-before[0][0]-before[1][0])/2,(after[0][1]+after[1][1]-before[0][1]-before[1][1])/2);
      }
      this._viewChanged();event.preventDefault();
    });
    const release=event=>{
      if(event.type==='pointerup'&&this._clickStart?.id===event.pointerId&&Math.hypot(event.clientX-this._clickStart.x,event.clientY-this._clickStart.y)<=5){const hit=this._markerAtEvent(event);if(hit){this.showLabel(hit.marker.id);this.onMarkerSelect?.(hit.marker);}}
      this._clickStart=null;this._pointers.delete(event.pointerId);if(!this._pointers.size)this.canvas.style.cursor='grab';
    };
    this._listen(this.canvas,'pointerup',release);this._listen(this.canvas,'pointercancel',release);this._listen(this.canvas,'lostpointercapture',release);
    this._listen(this.canvas,'wheel',event=>{
      const amount=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?this._height:1);
      this.zoomView(Math.exp(-clamp(amount,-400,400)*.0015));event.preventDefault();
    },{passive:false});
    this._listen(this.canvas,'keydown',event=>{
      if(event.altKey||event.ctrlKey||event.metaKey)return;
      if(event.shiftKey&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){
        this.panView(event.key==='ArrowLeft'?-24:event.key==='ArrowRight'?24:0,event.key==='ArrowUp'?-24:event.key==='ArrowDown'?24:0);
        event.preventDefault();event.stopPropagation();return;
      }
      if(event.key==='ArrowLeft')this.rotateView(-5,0);
      else if(event.key==='ArrowRight')this.rotateView(5,0);
      else if(event.key==='ArrowUp')this.rotateView(0,5);
      else if(event.key==='ArrowDown')this.rotateView(0,-5);
      else if(event.key==='+'||event.key==='=')this.zoomView(1/.88);
      else if(event.key==='-'||event.key==='_')this.zoomView(.88);
      else if(event.key==='Home'){this.resetView();event.preventDefault();event.stopPropagation();return;}
      else return;
      event.preventDefault();event.stopPropagation();
    });
  }

  async setFrame(frame,manifest,emptyMessage='No AIR volume is available at this time.') {
    if(this.destroyed)return false;
    this._desired={frame,manifest,emptyMessage};
    if(!this.active)return false;
    if(!this.supported)return false;
    if(!frame){
      if(this._empty&&this._emptyMessage===emptyMessage)return false;
      this._empty=true;this._emptyMessage=emptyMessage;
      this._generation++;this._controller?.abort();this._key=null;this._ready=false;this._pending=null;
      this._status('empty',emptyMessage);this._draw();return false;
    }
    this._empty=false;
    let grid,url,key;
    try {
      grid=gridContract(manifest);url=frame.volumeURL??frame.volume;
      if(typeof url!=='string'||!url.trim())throw new Error('This frame has no 3D radar volume.');
      if(grid.dimensions.some(n=>n>this.gl.getParameter(this.gl.MAX_3D_TEXTURE_SIZE)))throw new Error('This radar volume exceeds this device’s 3D texture limit.');
      key=url+'|'+grid.key;
    }catch(error){
      this._generation++;this._controller?.abort();this._key=null;this._ready=false;
      this._status('error',error.message,frame,error);this._schedule();return false;
    }
    if(key===this._key)return this._pending??this._ready;
    this._key=key;this._ready=false;this._grid=grid;
    this._viewChanged();
    const generation=++this._generation;
    this._controller?.abort();const controller=new AbortController();this._controller=controller;
    this._status('loading','Loading measured radar volume…',frame);this._draw();
    const task=(async()=>{
      try {
        let bytes=this._cache.get(key);
        if(bytes){this._cache.delete(key);this._cache.set(key,bytes);}
        else {
          const response=await fetch(url,{signal:controller.signal});
          if(!response.ok)throw new Error('The radar volume could not be loaded.');
          const raw=new Uint8Array(await response.arrayBuffer());
          if(controller.signal.aborted)return false;
          if(raw.length>32*1024*1024)throw new Error('The radar download is unexpectedly large.');
          if(raw[0]===31&&raw[1]===139){
            if(typeof DecompressionStream==='undefined')throw new Error('This browser cannot decompress 3D radar data. Use the 2D map.');
            const stream=new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'));
            bytes=new Uint8Array(await new Response(stream).arrayBuffer());
          }else bytes=raw; // Servers may transparently apply HTTP Content-Encoding.
          if(bytes.length!==grid.count)throw new Error('The radar volume has an unexpected number of cells.');
          if(controller.signal.aborted||generation!==this._generation)return false;
          this._cache.set(key,bytes);
          while(this._cache.size>3)this._cache.delete(this._cache.keys().next().value);
        }
        if(generation!==this._generation||!this.active||this.destroyed)return false;
        this._upload(bytes,manifest,grid);this._ready=true;
        this._status('ready','Measured reflectivity · drag to rotate · scroll or pinch to zoom',frame);
        this._schedule();return true;
      }catch(error){
        if(controller.signal.aborted||generation!==this._generation||this.destroyed)return false;
        // Keep the failed key so a 100 ms application render loop cannot
        // repeatedly request the same broken file. Changing frames or toggling
        // the viewer permits a retry.
        this._ready=false;
        this._status('error',error.message||'The 3D radar volume could not be displayed.',frame,error);this._schedule();return false;
      }finally{if(generation===this._generation)this._pending=null;}
    })();
    this._pending=task;return task;
  }

  _upload(bytes,manifest,grid) {
    const gl=this.gl;
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_3D,this._volumeTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
    gl.texImage3D(gl.TEXTURE_3D,0,gl.R8,...grid.dimensions,0,gl.RED,gl.UNSIGNED_BYTE,bytes);
    const stops=manifest.colorScales?.reflectivity?.stops??DEFAULT_STOPS;
    const colors=new Uint8Array(1024);
    for(let q=1;q<256;q++){
      const dbz=(q-grid.decode.indexOffset)*grid.decode.scale+grid.decode.offset;
      let hex=stops[0][1];for(const [minimum,color]of stops){if(dbz>=minimum)hex=color;else break;}
      if(!/^#[a-f0-9]{6}$/i.test(hex))throw new Error('The radar color scale is invalid.');
      for(let channel=0;channel<3;channel++)colors[q*4+channel]=parseInt(hex.slice(1+channel*2,3+channel*2),16);
      colors[q*4+3]=255;
    }
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this._paletteTexture);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,256,1,0,gl.RGBA,gl.UNSIGNED_BYTE,colors);
    if(gl.getError()!==gl.NO_ERROR)throw new Error('The device could not upload this radar volume.');
  }

  setOpacity(value) {if(Number.isFinite(value)){const next=clamp(value,0,1);if(next!==this.opacity){this.opacity=next;this._schedule();}}}
  setThreshold(dbz) {if(Number.isFinite(dbz)){const next=clamp(dbz,-32,95);if(next!==this.threshold){this.threshold=next;this._schedule();}}}
  /** Display-only radar translation in the original local east/north plane, km.
   * Source geometry and bytes stay intact; terrain and annotations never move.
   * A zero offset restores the recorded placement without resampling the data.
   */
  setRadarOffset(offset) {
    if(this.destroyed)return false;
    if(!Array.isArray(offset)||offset.length!==2||!offset.every(Number.isFinite))throw new TypeError('Radar offset must be [east, north] in kilometers.');
    const previous=this._radarOffset??[0,0];
    if(offset.every((value,index)=>value===previous[index]))return false;
    // Keep the camera anchored to the same ground-world location on a toggle.
    // Reset view can deliberately reframe the translated radar box afterward.
    this._pan[0]-=offset[0]-previous[0];this._pan[1]-=offset[1]-previous[1];
    this._radarOffset=[...offset];this._viewChanged();return true;
  }
  /** Positive yaw turns the view clockwise; positive pitch looks more downward. */
  rotateView(deltaYawDeg,deltaPitchDeg) {
    if(this.destroyed||![deltaYawDeg,deltaPitchDeg].every(Number.isFinite))return;
    this.yaw-=deltaYawDeg*DEG;this.pitch+=deltaPitchDeg*DEG;this._viewChanged();
  }
  panView(dxPx,dyPx) {if(!this.destroyed&&[dxPx,dyPx].every(Number.isFinite)){this._panPixels(dxPx,dyPx);this._viewChanged();}}
  /** A factor greater than one zooms in; all controls share a metric limit. */
  zoomView(factor) {if(!this.destroyed&&Number.isFinite(factor)&&factor>0){this.zoom/=factor;this._viewChanged();}}
  setViewPreset(preset) {
    const bearings={north:0,east:90,south:180,west:270,top:0};
    if(this.destroyed||!Object.hasOwn(bearings,preset))return false;
    this.yaw=-bearings[preset]*DEG;this.pitch=preset==='top'?89*DEG:.4;this._viewChanged();return true;
  }
  resetView() {this.yaw=0;this.pitch=.4;this.zoom=1;this._pan=[0,0,0];this._viewChanged();}
  focusMarker(id) {
    const marker=this._markers.find(m=>m.id===id);if(!marker)return false;
    const grid=this._camera().grid,point=[marker.x,marker.y,marker.z];
    this._pan=point.map((v,i)=>v-(grid.min[i]+grid.max[i])/2);this.zoom=.5;this.pitch=.4;this._viewChanged();return true;
  }
  getViewState() {
    const c=this._camera();
    return {bearingDegrees:(Math.atan2(c.forward[0],c.forward[1])/DEG+360)%360,tiltDegrees:Math.asin(-c.forward[2])/DEG,zoomRatio:c.baseDistance/c.distance,distanceKm:c.distance,centerKilometers:[...c.center],limits:{minDistanceKm:CAMERA_LIMITS.minDistanceKm,maxDistanceKm:c.baseDistance*CAMERA_LIMITS.maxDistanceRatio,minZoomRatio:1/CAMERA_LIMITS.maxDistanceRatio,maxZoomRatio:c.baseDistance/CAMERA_LIMITS.minDistanceKm,minTiltDegrees:CAMERA_LIMITS.minTiltDegrees,maxTiltDegrees:CAMERA_LIMITS.maxTiltDegrees,canZoomIn:c.distance>CAMERA_LIMITS.minDistanceKm+1e-6,canZoomOut:c.distance<c.baseDistance*CAMERA_LIMITS.maxDistanceRatio-1e-6}};
  }
  _viewChanged() {
    if(this.yaw< -Math.PI||this.yaw>=Math.PI)this.yaw=((this.yaw+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI;
    this.pitch=clamp(this.pitch,CAMERA_LIMITS.minTiltDegrees*DEG,CAMERA_LIMITS.maxTiltDegrees*DEG);
    let c=this._camera();this.zoom=clamp(this.zoom,CAMERA_LIMITS.minDistanceKm/c.baseDistance,CAMERA_LIMITS.maxDistanceRatio);
    if(c.clearanceCorrection>0)this._pan[2]+=c.clearanceCorrection;
    const state=this.getViewState(),key=JSON.stringify(state);
    if(key!==this._lastViewState){this._lastViewState=key;this.onViewChange?.(state);}
    this._schedule();
  }
  setAxisLabelsVisible(visible) {const next=Boolean(visible);if(this._axisLabelsVisible!==next){this._axisLabelsVisible=next;this._schedule();}}
  hideLabel(id) {if(id!=null&&!this._hiddenLabels.has(id)){this._hiddenLabels.add(id);this._emitLabelsChange();this._schedule();}}
  showLabel(id) {if(this._hiddenLabels.delete(id)){this._emitLabelsChange();this._schedule();}}
  restoreLabels() {if(this._hiddenLabels.size){this._hiddenLabels.clear();this._emitLabelsChange();this._schedule();}}
  _emitLabelsChange() {
    const state={hiddenCount:this._hiddenLabels.size,visibleHiddenCount:this._markers.filter(marker=>this._hiddenLabels.has(marker.id)).length},key=JSON.stringify(state);
    if(key!==this._lastLabelsState){this._lastLabelsState=key;this.onLabelsChange?.(state);}
  }
  setActive(active) {
    if(this.destroyed||this.active===Boolean(active))return;
    this.active=Boolean(active);this.element.style.visibility=this.active?'visible':'hidden';
    if(!this.active){this._generation++;this._controller?.abort();this._key=null;this._ready=false;this._pending=null;this._empty=false;cancelAnimationFrame(this._raf);this._raf=0;this._status('empty','3D radar is inactive.');}
    else{this.resize();if(this._desired)this.setFrame(this._desired.frame,this._desired.manifest,this._desired.emptyMessage);else this._schedule();}
  }
  resize() {
    if(this.destroyed)return;
    const rect=this.container.getBoundingClientRect();this._width=Math.max(1,rect.width);this._height=Math.max(1,rect.height);
    const ratio=Math.min(globalThis.devicePixelRatio||1,1.5,Math.sqrt(600000/(this._width*this._height)));
    const width=Math.max(1,Math.round(this._width*ratio)),height=Math.max(1,Math.round(this._height*ratio));
    if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}
    const labelRatio=Math.min(globalThis.devicePixelRatio||1,2);
    this.labels.width=Math.round(this._width*labelRatio);this.labels.height=Math.round(this._height*labelRatio);this._labelRatio=labelRatio;
    this._viewChanged();
  }
  _schedule() {if(this.active&&this.supported&&!this.destroyed&&!this._raf)this._raf=requestAnimationFrame(()=>{this._raf=0;this._draw();});}
  _panPixels(dx,dy) {
    const c=this._camera(),unitsPerPixel=2*c.distance*c.tanHalfFov/Math.max(1,this._height);
    this._pan=this._pan.map((v,i)=>v+(-c.right[i]*dx+c.up[i]*dy)*unitsPerPixel);
  }
  _terrainHeightAt(x,y) {
    const terrain=this._terrain;if(!terrain)return null;
    const [nx,ny]=terrain.dimensions,[x0,x1]=terrain.bounds.x,[y0,y1]=terrain.bounds.y;
    if(x<x0||x>x1||y<y0||y>y1)return null;
    const u=(x-x0)/(x1-x0)*(nx-1),v=(y-y0)/(y1-y0)*(ny-1),i=Math.min(nx-2,Math.floor(u)),j=Math.min(ny-2,Math.floor(v)),dx=u-i,dy=v-j;
    const h=[terrain.heights[j*nx+i],terrain.heights[j*nx+i+1],terrain.heights[(j+1)*nx+i],terrain.heights[(j+1)*nx+i+1]];
    // Match the actual mesh diagonal and missing-triangle mask, rather than
    // inventing a bilinear surface between the two rendered triangles.
    return dx>=dy
      ?[h[0],h[1],h[3]].every(Number.isFinite)?h[0]+(h[1]-h[0])*dx+(h[3]-h[1])*dy:null
      :[h[0],h[3],h[2]].every(Number.isFinite)?h[0]+(h[3]-h[2])*dx+(h[2]-h[0])*dy:null;
  }
  _camera() {
    const sourceGrid=this._grid??{min:[-45,0,0],max:[23,45,16],dimensions:[192,160,96],decode:{scale:.5,offset:-32,indexOffset:1}};
    const [east,north]=this._radarOffset??[0,0];
    // Translate only the sampled radar box. World coordinates for the terrain,
    // roads and chasers remain tied to the original geographic reference.
    const grid=east||north?{...sourceGrid,min:[sourceGrid.min[0]+east,sourceGrid.min[1]+north,sourceGrid.min[2]],max:[sourceGrid.max[0]+east,sourceGrid.max[1]+north,sourceGrid.max[2]]}:sourceGrid;
    const size=subtract(grid.max,grid.min),center=grid.min.map((v,i)=>(v+grid.max[i])/2+this._pan[i]);
    const aspect=this.canvas.width/this.canvas.height,tanHalfFov=Math.tan(Math.PI/8);
    const baseDistance=Math.hypot(...size)*.58/tanHalfFov/Math.min(1,aspect);
    const distance=clamp(baseDistance*this.zoom,CAMERA_LIMITS.minDistanceKm,baseDistance*CAMERA_LIMITS.maxDistanceRatio);
    const eye=[center[0]+Math.sin(this.yaw)*Math.cos(this.pitch)*distance,center[1]-Math.cos(this.yaw)*Math.cos(this.pitch)*distance,center[2]+Math.sin(this.pitch)*distance];
    const referenceHeight=this._terrainHeightAt(eye[0],eye[1])??grid.min[2];
    const clearanceCorrection=Math.max(0,referenceHeight+CAMERA_LIMITS.clearanceKm-eye[2]);
    eye[2]+=clearanceCorrection;center[2]+=clearanceCorrection;
    const forward=normalize(subtract(center,eye)),right=normalize(cross(forward,[0,0,1])),up=cross(right,forward);
    const clipRange=[.02,Math.max(100,Math.hypot(...eye)+Math.hypot(...grid.max.map((v,i)=>Math.max(Math.abs(v),Math.abs(grid.min[i]))))+100)];
    return {grid,size,center,eye,forward,right,up,aspect,tanHalfFov,distance,baseDistance,clearanceCorrection,clipRange};
  }
  _draw() {
    if(!this.supported||!this.active||this.destroyed)return;
    const gl=this.gl,u=this._uniforms,camera=this._camera(),g=camera.grid;
    const hasSurface=this._drawTerrain(camera);
    gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.useProgram(this._program);gl.bindVertexArray(this._vao);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_3D,this._volumeTexture);gl.uniform1i(u.volume,0);
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this._paletteTexture);gl.uniform1i(u.palette,1);
    gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,this._surfaceColor);gl.uniform1i(u.surfaceColor,2);
    gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,this._surfaceDepth);gl.uniform1i(u.surfaceDepth,3);
    for(const [name,value]of Object.entries({boxMin:g.min,boxMax:g.max,eye:camera.eye,forward:camera.forward,right:camera.right,up:camera.up,cellSize:camera.size.map((v,i)=>v/g.dimensions[i])}))gl.uniform3fv(u[name],value);
    gl.uniform2f(u.resolution,this.canvas.width,this.canvas.height);
    gl.uniform2fv(u.clipRange,camera.clipRange);gl.uniform1i(u.hasSurface,hasSurface?1:0);
    for(const [name,value]of Object.entries({aspect:camera.aspect,tanHalfFov:camera.tanHalfFov,threshold:this.threshold,opacity:this.opacity,valueScale:g.decode.scale,valueOffset:g.decode.offset,indexOffset:g.decode.indexOffset}))gl.uniform1f(u[name],value);
    gl.uniform1i(u.hasVolume,this._ready?1:0);gl.drawArrays(gl.TRIANGLES,0,3);
    this._drawLabels(camera);
  }
  _markerAtEvent(event) {
    const rect=this.canvas.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;
    return this._markerHits.filter(hit=>Math.hypot(hit.x-x,hit.y-y)<=hit.radius).sort((a,b)=>Math.hypot(a.x-x,a.y-y)-Math.hypot(b.x-x,b.y-y)||b.marker.priority-a.marker.priority)[0]??null;
  }
  _drawRoadAnnotations(ctx,project) {
    ctx.save();ctx.lineJoin='round';ctx.lineCap='round';
    for(const road of this._roads){
      ctx.strokeStyle=road.major?'#b0bda5':'#829a88';ctx.lineWidth=road.major?1.4:.75;ctx.globalAlpha=road.major?.72:.46;
      ctx.beginPath();let drawing=false;
      for(const point of road.points){
        const p=point?.length===3&&point.every(Number.isFinite)?project(point):null;
        if(!p){drawing=false;continue;}
        if(drawing)ctx.lineTo(...p);else{ctx.moveTo(...p);drawing=true;}
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  _drawMarkerAnnotations(ctx,project) {
    this._markerHits=[];
    for(const button of this._labelButtons.values())button.hidden=true;
    const visible=this._markers.flatMap(marker=>{
      const p=project([marker.x,marker.y,marker.z]);
      return p&&p[0]>=4&&p[0]<=this._width-4&&p[1]>=4&&p[1]<=this._height-4&&marker.opacity>0?[{marker,p}]:[];
    }).sort((a,b)=>b.marker.priority-a.marker.priority);
    // Paint important symbols last, but allocate their labels first below.
    for(const {marker,p} of [...visible].reverse()){
      ctx.save();ctx.translate(...p);ctx.globalAlpha=marker.opacity;
      if(marker.kind==='suv'){
        if(Number.isFinite(marker.headingDegrees)){
          const angle=marker.headingDegrees*Math.PI/180,ahead=project([marker.x+Math.sin(angle)*.05,marker.y+Math.cos(angle)*.05,marker.z]);
          if(ahead)ctx.rotate(Math.atan2(ahead[1]-p[1],ahead[0]-p[0])+Math.PI/2);
        }
        ctx.fillStyle='#101c17';ctx.fillRect(-8,-9,16,18);ctx.fillStyle=marker.color;ctx.fillRect(-6,-12,12,24);
        ctx.strokeStyle='#eff2e8';ctx.lineWidth=1;ctx.strokeRect(-6,-12,12,24);
        ctx.fillStyle='#314948';ctx.fillRect(-4,-7,8,5);ctx.fillRect(-4,6,8,3);
        ctx.fillStyle='#efe7c1';ctx.fillRect(-5,-12,3,2);ctx.fillRect(2,-12,3,2);
      }else{
        if(marker.selected){
          ctx.lineJoin='round';ctx.strokeStyle='#0a1712';ctx.lineWidth=6;ctx.strokeRect(-8,-8,16,16);
          ctx.strokeStyle='#fff9e9';ctx.lineWidth=2;ctx.strokeRect(-8,-8,16,16);
        }
        ctx.beginPath();ctx.arc(0,0,4.5,0,Math.PI*2);ctx.fillStyle=marker.color;ctx.fill();ctx.strokeStyle='#10231c';ctx.lineWidth=2;ctx.stroke();
      }
      ctx.restore();this._markerHits.push({marker,x:p[0],y:p[1],radius:marker.kind==='suv'?16:marker.selected?12:10});
    }
    const occupied=this._width>=122?[{x:this._width-113,y:7,w:98,h:84}]:[];
    const overlaps=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
    for(const {marker,p} of visible){
      if(this._hiddenLabels.has(marker.id))continue;
      ctx.font=(marker.kind==='suv'?'600 ':'')+'11px system-ui,sans-serif';
      const text=String(marker.label??marker.id??'Chaser'),w=ctx.measureText(text).width+36,h=24;
      if(w>this._width-16)continue;
      const x=clamp(p[0]-w/2,8,this._width-w-8);
      const candidates=[{x,y:p[1]-(marker.kind==='suv'?40:32),w,h},{x,y:p[1]+(marker.kind==='suv'?20:12),w,h}].filter(r=>r.y>=6&&r.y+r.h<=this._height-6);
      let box=candidates.find(r=>!occupied.some(other=>overlaps(r,other))&&!this._markerHits.some(hit=>hit.marker!==marker&&overlaps(r,{x:hit.x-hit.radius,y:hit.y-hit.radius,w:hit.radius*2,h:hit.radius*2})));
      if(!box&&marker.kind==='suv')box=candidates[0];
      if(!box)continue;
      occupied.push(box);ctx.save();ctx.globalAlpha=marker.opacity;ctx.fillStyle='#0b1815e8';ctx.fillRect(box.x,box.y,box.w,box.h);
      ctx.fillStyle=marker.color;ctx.fillRect(box.x,box.y,3,box.h);ctx.fillStyle='#e8eee0';ctx.textAlign='left';ctx.fillText(text,box.x+7,box.y+16);ctx.restore();
      if(marker.id!=null){
        let button=this._labelButtons.get(marker.id);
        if(!button){
          button=document.createElement('button');button.type='button';button.textContent='×';button.className='air-volume-label-close';
          Object.assign(button.style,{position:'absolute',width:'24px',height:'24px',padding:'0',border:'0',borderRadius:'2px',font:'17px/24px system-ui,sans-serif',background:'#253d32',color:'#e8eee0',cursor:'pointer',pointerEvents:'auto'});
          button.addEventListener('pointerdown',event=>event.stopPropagation());
          button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();this.hideLabel(marker.id);this.canvas.focus({preventScroll:true});});
          this._labelButtons.set(marker.id,button);this.labelControls.append(button);
        }
        button.hidden=false;button.title='Hide '+text+' label';button.setAttribute('aria-label','Hide label for '+text);
        button.style.left=(box.x+box.w-24)+'px';button.style.top=box.y+'px';button.style.opacity=String(marker.opacity);
      }
    }
  }
  _drawCompass(ctx,camera) {
    const x=this._width-64,y=49;if(x<58)return;
    ctx.save();ctx.fillStyle='#0b1815d9';ctx.fillRect(x-49,y-42,98,84);
    ctx.strokeStyle='#657c6655';ctx.strokeRect(x-49,y-42,98,84);
    for(const [axis,name,color] of [[[0,1,0],'N','#f0dfb8'],[[1,0,0],'E','#b8d1bd']]){
      const direction=[dot(axis,camera.right),-dot(axis,camera.up)],length=Math.hypot(...direction);
      if(length<1e-6)continue;
      const dx=direction[0]/length,dy=direction[1]/length,tip=[x+dx*25,y+dy*25];
      ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=1.8;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(...tip);ctx.stroke();
      ctx.beginPath();ctx.moveTo(...tip);ctx.lineTo(tip[0]-dx*7-dy*3,tip[1]-dy*7+dx*3);ctx.lineTo(tip[0]-dx*7+dy*3,tip[1]-dy*7-dx*3);ctx.closePath();ctx.fill();
      ctx.font='600 11px system-ui,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(name,x+dx*35,y+dy*35);
    }
    ctx.fillStyle='#d6e1cd';ctx.beginPath();ctx.arc(x,y,2,0,Math.PI*2);ctx.fill();ctx.restore();
  }
  _drawLabels(camera) {
    const ctx=this.labels.getContext('2d');if(!ctx)return;
    ctx.setTransform(this._labelRatio,0,0,this._labelRatio,0,0);ctx.clearRect(0,0,this._width,this._height);
    const project=point=>{
      const relative=subtract(point,camera.eye),depth=dot(relative,camera.forward);
      if(depth<=.001)return null;
      return [(dot(relative,camera.right)/(depth*camera.tanHalfFov*camera.aspect)*.5+.5)*this._width,(.5-dot(relative,camera.up)/(depth*camera.tanHalfFov)*.5)*this._height];
    };
    this._drawRoadAnnotations(ctx,project);
    const line=(a,b,color='#819b7e99')=>{a=project(a);b=project(b);if(!a||!b)return;ctx.strokeStyle=color;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();};
    const label=(point,text,dx=0,dy=0)=>{
      const p=project(point);if(!p)return;
      const anchorX=p[0]+dx,y=p[1]+dy;
      if(anchorX<10||anchorX>this._width-10||y<18||y>this._height-16)return;
      ctx.font='11px system-ui,sans-serif';
      const halfWidth=ctx.measureText(text).width/2;
      if(halfWidth*2>this._width-20)return;
      const x=clamp(anchorX,halfWidth+10,this._width-halfWidth-10);
      ctx.textAlign='center';ctx.lineJoin='round';ctx.lineWidth=4;ctx.strokeStyle='#0b1512';ctx.strokeText(text,x,y);ctx.fillStyle='#d7e1cc';ctx.fillText(text,x,y);
    };
    const [x0,y0,z0]=camera.grid.min,[x1,y1,z1]=camera.grid.max;
    const corners=[[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0]];
    for(let i=0;i<4;i++){line(corners[i],corners[(i+1)%4]);line(corners[i],[corners[i][0],corners[i][1],z1],'#91a58c45');}
    // Choose the nearest box corner for the altitude ruler as the camera turns.
    const base=[...corners].sort((a,b)=>Math.hypot(...subtract(a,camera.eye))-Math.hypot(...subtract(b,camera.eye)))[0];
    line(base,[base[0],base[1],z1],'#c4d2b4aa');
    if(this._axisLabelsVisible){
      for(let height=Math.ceil(z0/4)*4;height<=z1;height+=4)label([base[0],base[1],height],height+' km',-24,3);
      label([base[0],base[1],z1],'MSL',-24,-14);
      label([(x0+x1)/2,y0,z0],'East–west extent · '+Math.round(x1-x0)+' km',0,24);
      label([x1,(y0+y1)/2,z0],'North–south extent · '+Math.round(y1-y0)+' km',45,0);
      const [east,north]=this._radarOffset??[0,0];
      if(!this._terrainCount&&x0<=east&&x1>=east&&y0<=north&&y1>=north){label([east,north,z0],east||north?'AIR display reference · 0 MSL':'AIR reference · 0 MSL',0,12);}
    }
    this._drawMarkerAnnotations(ctx,project);
    this._drawCompass(ctx,camera);
  }
  destroy() {
    if(this.destroyed)return;this.destroyed=true;this._generation++;this._controller?.abort();cancelAnimationFrame(this._raf);this._observer?.disconnect();
    for(const remove of this._listeners)remove();this._listeners=[];this._cache.clear();
    if(this.gl){
      for(const t of [this._volumeTexture,this._paletteTexture,this._surfaceColor,this._surfaceDepth])if(t)this.gl.deleteTexture(t);
      for(const b of [this._buffer,this._terrainBuffer,this._terrainIndexBuffer])if(b)this.gl.deleteBuffer(b);
      for(const v of [this._vao,this._terrainVao])if(v)this.gl.deleteVertexArray(v);
      for(const p of [this._program,this._terrainProgram])if(p)this.gl.deleteProgram(p);
      if(this._surfaceFramebuffer)this.gl.deleteFramebuffer(this._surfaceFramebuffer);
    }
    this._labelButtons.clear();this._hiddenLabels.clear();this.element.remove();this.container.style.position=this._oldPosition;
  }
}
