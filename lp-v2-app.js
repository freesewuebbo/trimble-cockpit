import * as THREE from "three";
import {OrbitControls} from "three/addons/controls/OrbitControls.js";
import {TransformControls} from "three/addons/controls/TransformControls.js";
import * as WebIFC from "https://cdn.jsdelivr.net/npm/web-ifc@0.0.77/web-ifc-api.js";
import {buildIfcVariant} from "./lp-v2-step.js?build=V2";
import {createSupplementIfc} from "./lp-v2-supplement.js?build=V2";

const $=id=>document.getElementById(id);
const models=new Map(),objects=new Map(),groups=new Map(),groupOf=new Map(),selected=new Set();
const classFlags=new Map(),libraryModules=new Map();
let ifcApi=null,activeModel=null,groupIndex=0,itemIndex=0,mode="translate",drawKind=null,drawStart=null,preview=null,measureStart=null,pivot=null;
let clipEnabled=false,currentExports=[],trimbleConnected=false,pointcloud=null,undoStack=[],redoStack=[],muteHistory=false,busy=false;
const COLORS={machine:0x9aaab5,rack:0x8ba9be,forklift:0xeac468,workplace:0x96b7ad,wall:0xc5cdd3,conveyor:0x8ab1c3};
const drawingDefault={box:0x96aebb,wall:0xc2c9ce,column:0xa4b2bd,slab:0xe1e5e7,route:0xd2c699,area:0xbadab7};
const DEMO_PARTS=["lp01-demo-part-1.txt","lp01-demo-part-2.txt","lp01-demo-part-3.txt","lp01-demo-part-4.txt"];
const outputNames={box:"Quader",wall:"Wand",column:"Stütze",slab:"Boden",route:"Fahrweg",area:"Fläche"};
const viewer=$("viewer"),canvas=$("canvas");
THREE.Object3D.DEFAULT_UP.set(0,0,1);
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:false});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0xe9eff1);
renderer.localClippingEnabled=true;
const scene=new THREE.Scene(),world=new THREE.Group();scene.add(world);
const camera=new THREE.PerspectiveCamera(45,1,.05,100000);camera.up.set(0,0,1);
camera.position.set(34,-39,30);
const orbit=new OrbitControls(camera,canvas);orbit.target.set(13,10,2);orbit.enableDamping=true;orbit.dampingFactor=.08;orbit.update();
scene.add(new THREE.HemisphereLight(0xffffff,0x9faab2,2.0));
const light=new THREE.DirectionalLight(0xffffff,2.2);light.position.set(30,-10,50);scene.add(light);
const grid=new THREE.GridHelper(100,100,0xaab7bd,0xd9e0e4);grid.rotation.x=Math.PI/2;grid.position.z=-0.005;scene.add(grid);
const controls=new TransformControls(camera,canvas);scene.add(controls.getHelper());
controls.setMode("translate");controls.setSpace("world");controls.setSize(.8);
controls.addEventListener("dragging-changed",e=>{orbit.enabled=!e.value;if(!e.value){releasePivot();capture("Transformation");updateUI()}});
controls.addEventListener("objectChange",()=>{updateSelectedStats()});
const clipPlanes=[new THREE.Plane(new THREE.Vector3(-1,0,0),50),new THREE.Plane(new THREE.Vector3(0,-1,0),50),new THREE.Plane(new THREE.Vector3(0,0,-1),6)];
const setStatus=(message,error=false)=>{$("status").textContent=message;$("status").title=message;$("status").style.color=error?"#b34136":""};
const safeName=s=>String(s||"").replace(/[^A-Za-z0-9äöüÄÖÜ_. -]/g,"_").slice(0,100);
const num=(id,fallback=0)=>{const v=Number($(id).value);return Number.isFinite(v)?v:fallback};
const fmt=v=>Number(v).toFixed(2);
const html=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function button(text,onClick,cls=""){const b=document.createElement("button");b.textContent=text;b.className=cls;b.onclick=onClick;return b;}
function roundGrid(p){if($("snapEnabled").checked){p.x=Math.round(p.x*2)/2;p.y=Math.round(p.y*2)/2}return p;}
function worldBox(o){o.updateMatrixWorld(true);return new THREE.Box3().setFromObject(o)}
function visualMeshes(o){const result=[];o.traverse(ch=>{if(ch.isMesh&&ch!==preview)result.push(ch)});return result}
function isSelectable(o){if(!o||o.userData.deleted||!o.visible)return false;const model=models.get(o.userData.modelKey);if(model&&!model.visible)return false;const st=classFlags.get(o.userData.classKey);return !st?.locked&&st?.visible!==false}
function activeRoots(){return [...selected].map(id=>objects.get(id)).filter(isSelectable)}
function nextKey(prefix){return prefix+"-"+(++itemIndex).toString().padStart(4,"0")}
function register(root){
 const id=root.userData.lpId;if(objects.has(id))throw Error("Objekt-ID bereits vorhanden: "+id);
 objects.set(id,root);root.userData.name=root.userData.name||id;root.name=root.userData.name;
 root.traverse(ch=>{if(ch.isMesh){ch.userData.lpRoot=root;ch.material=Array.isArray(ch.material)?ch.material.map(m=>m.clone()):ch.material.clone();}});
 const key=root.userData.classKey||"IfcBuildingElementProxy";root.userData.classKey=key;
 if(!classFlags.has(key))classFlags.set(key,{visible:true,locked:false});
 (root.userData.modelKey?models.get(root.userData.modelKey)?.group:world)?.add(root);
}
function forget(root){
 const gid=groupOf.get(root.userData.lpId);if(gid){groups.get(gid)?.items.delete(root.userData.lpId);groupOf.delete(root.userData.lpId)}
 selected.delete(root.userData.lpId);objects.delete(root.userData.lpId);root.parent?.remove(root);
}
function releasePivot(){
 if(!pivot)return;controls.detach();pivot.updateMatrixWorld(true);
 for(const r of [...pivot.children])world.attach(r);
 scene.remove(pivot);pivot=null;
}
function rebuildTransform(){
 releasePivot();const rs=activeRoots();
 if(!rs.length){controls.detach();return}
 if(rs.length===1){controls.attach(rs[0]);return}
 const center=new THREE.Vector3();rs.forEach(x=>center.add(x.getWorldPosition(new THREE.Vector3())));center.multiplyScalar(1/rs.length);
 pivot=new THREE.Group();pivot.position.copy(center);world.add(pivot);pivot.updateMatrixWorld(true);
 for(const r of rs)pivot.attach(r);
 controls.attach(pivot);
}
function expand(ids){
 const result=new Set();for(const id of ids){const gid=groupOf.get(id);if(gid&&groups.has(gid)){for(const v of groups.get(gid).items)result.add(v)}else result.add(id)}
 return [...result];
}
function select(ids,add=false,individual=false){
 releasePivot();
 const expanded=individual?ids:expand(ids);
 if(!add)selected.clear();
 const remove=add&&expanded.every(x=>selected.has(x));
 for(const id of expanded){const r=objects.get(id);if(!isSelectable(r))continue;if(remove)selected.delete(id);else selected.add(id)}
 rebuildTransform();colorSelection();updateUI();
}
function colorSelection(){
 for(const r of objects.values())for(const mesh of visualMeshes(r)){
  if(!mesh.material||Array.isArray(mesh.material))continue;
  if("emissive" in mesh.material){
   mesh.material.emissive.setHex(selected.has(r.userData.lpId)?0x17506a:0x000000);
   mesh.material.emissiveIntensity=selected.has(r.userData.lpId)?.35:0;
  }
 }
}
function clearSelection(){select([])}
function modelKey(){return "MODEL-"+Math.random().toString(36).slice(2,10)}
function modelEntries(key){return [...objects.values()].filter(o=>o.userData.modelKey===key)}
function sourceGUID(info){const v=info?.GlobalId?.value;return typeof v==="string"?v:""}
function typeName(handle,eid){try{return ifcApi.GetNameFromTypeCode(ifcApi.GetLineType(handle,eid))||"IfcElement"}catch(_){return"IfcElement"}}
function makeGeometry(handle,pg){
 const g=ifcApi.GetGeometry(handle,pg.geometryExpressID);
 try{
  const data=ifcApi.GetVertexArray(g.GetVertexData(),g.GetVertexDataSize());
  const faces=ifcApi.GetIndexArray(g.GetIndexData(),g.GetIndexDataSize());
  const n=data.length/6,pos=new Float32Array(n*3),norm=new Float32Array(n*3);
  for(let i=0;i<n;i++){pos[3*i]=data[6*i];pos[3*i+1]=data[6*i+1];pos[3*i+2]=data[6*i+2];norm[3*i]=data[6*i+3];norm[3*i+1]=data[6*i+4];norm[3*i+2]=data[6*i+5]}
  const geom=new THREE.BufferGeometry();geom.setAttribute("position",new THREE.BufferAttribute(pos,3));geom.setAttribute("normal",new THREE.BufferAttribute(norm,3));geom.setIndex(new THREE.BufferAttribute(new Uint32Array(faces),1));
  geom.applyMatrix4(new THREE.Matrix4().fromArray(pg.flatTransformation));
  geom.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI/2));return geom;
 }finally{g.delete?.()}
}
function matFrom(pg){
 const c=pg.color;return new THREE.MeshStandardMaterial({
  color:c?new THREE.Color(c.x,c.y,c.z):new THREE.Color(0x9fadb5),roughness:.85,metalness:.08,
  transparent:!!(c&&c.w<.98),opacity:c?Math.min(1,Math.max(.1,c.w)):1,side:THREE.DoubleSide
 });
}
function recenter(root){
 const box=new THREE.Box3().setFromObject(root);if(box.isEmpty())return;
 const center=box.getCenter(new THREE.Vector3());
 for(const child of root.children)if(child.geometry)child.geometry.translate(-center.x,-center.y,-center.z);
 root.position.copy(center);
}
async function engine(){if(!ifcApi){setStatus("IFC-Engine wird geladen …");ifcApi=new WebIFC.IfcAPI();const url="https://cdn.jsdelivr.net/npm/web-ifc@0.0.77/web-ifc.wasm";await ifcApi.Init((path,prefix)=>url,true)}}
async function addIFC(bytes,fileName,ctx={}){
 if(busy)throw Error("Es wird bereits eine IFC geladen.");
 busy=true;const key=modelKey(),name=fileName||"Modell.ifc";
 try{
  await engine();if(bytes.byteLength>350*1024*1024)throw Error("IFC-Datei >350 MB: Browser-Testgrenze.");
  const first=new TextDecoder().decode(bytes.slice(0,60));if(!first.trimStart().startsWith("ISO-10303-21;"))throw Error("Keine IFC-Rohdatei (STEP-Signatur fehlt).");
  const handle=ifcApi.OpenModel(bytes,{COORDINATE_TO_ORIGIN:false,CIRCLE_SEGMENTS:24});if(handle===-1)throw Error("IFC-Engine hat Modell zurückgewiesen.");
  const group=new THREE.Group();group.name=name;world.add(group);
  const m={key,name,handle,group,visible:true,source:new TextDecoder().decode(bytes),trimble:ctx,unit:"m",loadTime:new Date().toISOString()};
  models.set(key,m);
  let count=0;setStatus(name+" · IFC-Geometrien werden aufgebaut …");
  ifcApi.StreamAllMeshes(handle,flat=>{
   const id=Number(flat.expressID),info=ifcApi.GetLine(handle,id),cls=typeName(handle,id),root=new THREE.Group();
   for(let j=0;j<flat.geometries.size();j++){
    const pg=flat.geometries.get(j),mesh=new THREE.Mesh(makeGeometry(handle,pg),matFrom(pg));root.add(mesh);
   }
   if(!root.children.length)return;
   recenter(root);
   root.userData={lpId:key+":"+id,sourceId:key+":"+id,expressID:id,guid:sourceGUID(info),ifcClass:cls,
    classKey:key+"|"+cls,modelKey:key,kind:"ifc",name:info?.Name?.value||info?.Tag?.value||cls+" #"+id};
   register(root);root.updateWorldMatrix(true,true);root.userData.lpBaseWorldMatrix=root.matrixWorld.toArray();root.userData.basePosition=root.position.clone();count++;
  });
  setStatus(name+" geladen · "+count+" IFC-Objekte");renderModels();renderClasses();renderObjects();fitAll();capture("IFC importiert");
  return key;
 }catch(e){
  const m=models.get(key);if(m){for(const r of modelEntries(key))forget(r);m.group.removeFromParent();models.delete(key);try{ifcApi.CloseModel(m.handle)}catch(_){}}
  setStatus("IFC konnte nicht geladen werden: "+e.message,true);throw e;
 }finally{busy=false}
}
async function loadDemo(){
 try{
  setStatus("Demo-Halle wird vorbereitet …");
  const all=await Promise.all(DEMO_PARTS.map(p=>fetch("./"+p).then(r=>{if(!r.ok)throw Error(p+" nicht erreichbar");return r.text()})));
  const bytes=Uint8Array.from(atob(all.join("")),c=>c.charCodeAt(0));
  const decoded=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  await addIFC(new Uint8Array(decoded),"LEANNOVA Demo-Halle");
 }catch(e){setStatus("Demo nicht geladen: "+e.message,true)}
}
function makeShape(x,y,z,sx,sy,sz,color){
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color,roughness:.8,side:THREE.DoubleSide}));
 mesh.scale.set(sx,sy,sz);
 const root=new THREE.Group();root.add(mesh);root.position.set(x,y,z);
 root.userData={lpId:nextKey("DRAW"),sourceId:null,modelKey:null,ifcClass:"IfcBuildingElementProxy",classKey:"Eigene Layout-Objekte",
 kind:"draw",name:"Objekt "+itemIndex,dimensions:[sx,sy,sz]};
 register(root);return root;
}
function drawObject(kind,center,dims,name,show=true){
 const sx=Math.max(.01,dims[0]),sy=Math.max(.01,dims[1]),sz=Math.max(.01,dims[2]);
 const root=makeShape(center.x,center.y,center.z,sx,sy,sz,drawingDefault[kind]||0xaabbcc);
 root.userData.drawKind=kind;root.userData.name=name||outputNames[kind]||"Objekt";
 root.name=root.userData.name;
 if(!show)root.visible=false;return root;
}
function setMode(v){
 mode=v;drawKind=null;drawStart=null;clearPreview();
 if(v==="select")controls.detach();else{controls.setMode(v);controls.showX=controls.showY=controls.showZ=true;rebuildTransform()}
 for(const [key,modeVal] of [["modeMove","translate"],["modeRotate","rotate"],["modeScale","scale"],["modeSelect","select"]]){
  $(key).classList.toggle("active",v===modeVal)
 }
 document.querySelectorAll("[data-draw]").forEach(b=>b.classList.remove("active"));
 setStatus(v==="scale"?"Skalierung: X/Y/Z-Griffe verwenden.":"Werkzeug: "+v);
}
function clearPreview(){if(preview){preview.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose()}});preview.removeFromParent();preview=null}}
function chooseDraw(kind){setMode("select");drawKind=kind;document.querySelectorAll("[data-draw]").forEach(b=>b.classList.toggle("active",b.dataset.draw===kind));$("liveInfo").textContent="Zeichnen: "+kind+" · Startpunkt klicken";}
const floorPlane=new THREE.Plane(new THREE.Vector3(0,0,1),0);
function pointer(e){
 const box=canvas.getBoundingClientRect(),p=new THREE.Vector2(2*(e.clientX-box.left)/box.width-1,1-2*(e.clientY-box.top)/box.height);
 const ray=new THREE.Raycaster();ray.setFromCamera(p,camera);return ray;
}
function floorPoint(e){return roundGrid(pointer(e).ray.intersectPlane(floorPlane,new THREE.Vector3())||new THREE.Vector3())}
function drawingDims(a,b,kind){
 let x=Math.abs(b.x-a.x),y=Math.abs(b.y-a.y);
 const defaultX=Math.abs(num("drawL",4)),defaultY=Math.abs(num("drawW",2));
 if(x<.05)x=defaultX;if(y<.05)y=defaultY;
 if(kind==="wall")y=Math.min(y,.2);if(kind==="column"){x=Math.min(x,.5);y=Math.min(y,.5)}
 return[x,y,kind==="route"||kind==="area"||kind==="slab"?.08:Math.max(.1,num("drawH",3))];
}
function newObjectFromDraw(a,b,kind){
 const d=drawingDims(a,b,kind);
 let x=(a.x+b.x)/2,y=(a.y+b.y)/2;
 if(Math.abs(a.x-b.x)<.05)x=a.x+d[0]/2;
 if(Math.abs(a.y-b.y)<.05)y=a.y+d[1]/2;
 const root=drawObject(kind,new THREE.Vector3(x,y,d[2]/2),d,$("drawName").value.trim()||outputNames[kind]+" "+(itemIndex+1));
 select([root.userData.lpId]);capture("Gezeichnet");renderObjects();return root;
}
function showDrawingPreview(a,b,kind){
 clearPreview();const d=drawingDims(a,b,kind);
 preview=new THREE.Mesh(new THREE.BoxGeometry(d[0],d[1],d[2]),new THREE.MeshBasicMaterial({color:0x1499bb,wireframe:true}));
 preview.position.set((a.x+b.x)/2,(a.y+b.y)/2,d[2]/2);
 scene.add(preview);
 $("liveInfo").textContent=kind+": "+fmt(d[0])+" × "+fmt(d[1])+" × "+fmt(d[2])+" m · Fläche "+fmt(d[0]*d[1])+" m²";
}
function pickFromRay(e){
 const roots=[...objects.values()].filter(isSelectable),meshes=roots.flatMap(visualMeshes);
 const hits=pointer(e).intersectObjects(meshes,false);
 return hits.length?hits[0].object.userData.lpRoot:null;
}
let pointerDown=null;
canvas.addEventListener("pointerdown",e=>{
 if(controls.axis)return;pointerDown={x:e.clientX,y:e.clientY,time:Date.now()};
 if(drawKind){const p=floorPoint(e);if(!drawStart){drawStart=p;$("liveInfo").textContent="Zweiten Eckpunkt anklicken …"}else{
 const a=drawStart;drawStart=null;clearPreview();newObjectFromDraw(a,p,drawKind);}}
 else if(measureStart!==null){
 const hit=pickFromRay(e),p=hit?worldBox(hit).getCenter(new THREE.Vector3()):floorPoint(e);
 if(!measureStart){measureStart=p;$("measureOutput").textContent="Erster Punkt markiert."}else{
  const d=p.clone().sub(measureStart),distance=d.length();
  $("measureOutput").textContent="3D: "+fmt(distance)+" m · X "+fmt(Math.abs(d.x))+" · Y "+fmt(Math.abs(d.y))+" · Z "+fmt(Math.abs(d.z));measureStart=null;}}
 else{
  const r=pickFromRay(e);if(r)select([r.userData.lpId],e.shiftKey,e.altKey);else if(!e.shiftKey)clearSelection();
 }
});
canvas.addEventListener("pointermove",e=>{if(drawKind&&drawStart)showDrawingPreview(drawStart,floorPoint(e),drawKind)});
function defaultColor(o){if(o.userData.kind==="draw")return drawingDefault[o.userData.drawKind]||0x96aebb;return 0x9aabb5}
function selectInfo(){
 const roots=activeRoots();if(!roots.length)return;
 const bb=new THREE.Box3();roots.forEach(r=>bb.union(worldBox(r)));
 const center=bb.getCenter(new THREE.Vector3()),size=bb.getSize(new THREE.Vector3());
 ["posX","posY","posZ"].forEach((id,i)=>$(id).value=fmt(center.getComponent(i)));
 ["sizeX","sizeY","sizeZ"].forEach((id,i)=>$(id).value=fmt(size.getComponent(i)));
 $("selectionMeasurements").textContent=fmt(size.x)+" × "+fmt(size.y)+" × "+fmt(size.z)+" m · "+fmt(size.x*size.y)+" m² Grundfläche";
 if(roots.length===1){$("objectName").value=roots[0].userData.name;$("selectionText").textContent=roots[0].userData.name+" · "+roots[0].userData.ifcClass}
 else{$("objectName").value="";$("selectionText").textContent=roots.length+" Objekte ausgewählt"}
}
function updateSelectedStats(){const roots=activeRoots();if(roots.length){const box=new THREE.Box3();roots.forEach(r=>box.union(worldBox(r)));const v=box.getSize(new THREE.Vector3());$("selectionMeasurements").textContent=fmt(v.x)+" × "+fmt(v.y)+" × "+fmt(v.z)+" m · "+fmt(v.x*v.y)+" m²"}}
function updateUI(){selectInfo();if(!selected.size){$("selectionText").textContent="Kein Objekt ausgewählt";$("selectionMeasurements").textContent="—"}renderObjects();}
function capture(label){
 if(muteHistory)return;
 try{const snap=JSON.stringify(toProject(false));if(undoStack.at(-1)?.snapshot===snap)return;
  undoStack.push({label,snapshot:snap});if(undoStack.length>25)undoStack.shift();redoStack=[];
 }catch(e){console.warn("History",e)}
}
function toProject(includeFiles=true){
 releasePivot();
 return{schema:"LEANNOVA-LP-V2",at:new Date().toISOString(),
  models:[...models.values()].map(m=>({key:m.key,name:m.name,source:includeFiles?m.source:null,trimble:m.trimble,visible:m.visible})),
  objects:[...objects.values()].map(r=>({id:r.userData.lpId,kind:r.userData.kind,sourceId:r.userData.sourceId,
   modelKey:r.userData.modelKey,ifcClass:r.userData.ifcClass,name:r.userData.name,drawKind:r.userData.drawKind,
   position:r.position.toArray(),quaternion:r.quaternion.toArray(),scale:r.scale.toArray(),
   isCopy:!!r.userData.isCopy,hidden:!r.visible,deleted:!!r.userData.deleted,
   geometry:r.userData.kind==="draw"?r.children[0].scale.toArray():null,
   color:visualMeshes(r)[0]?.material?.color?.getHex()||null,
   opacity:visualMeshes(r)[0]?.material?.opacity||1
  })),
  groups:[...groups.values()].map(g=>({id:g.id,name:g.name,items:[...g.items],hidden:g.hidden||false})),
  classFlags:[...classFlags],camera:{position:camera.position.toArray(),target:orbit.target.toArray()},
  clip:{enabled:$("clipEnabled").checked,x:num("clipX"),y:num("clipY"),z:num("clipZ")}};
}
function restoreView(data){
 muteHistory=true;
 try{
  for(const o of data.objects||[]){
   let r=objects.get(o.id);
   if(!r&&o.kind==="draw"){
    const geom=o.geometry||[1,1,1];
    r=drawObject(o.drawKind||"box",new THREE.Vector3(),geom,o.name);
    objects.delete(r.userData.lpId);r.userData.lpId=o.id;objects.set(o.id,r);
   }else if(!r&&o.isCopy&&objects.has(o.sourceId)){
    r=cloneObject(objects.get(o.sourceId));objects.delete(r.userData.lpId);r.userData.lpId=o.id;objects.set(o.id,r);
   }
   if(!r)continue;
   r.position.fromArray(o.position);r.quaternion.fromArray(o.quaternion||[0,0,0,1]);r.scale.fromArray(o.scale||[1,1,1]);
   r.visible=!o.hidden;r.userData.deleted=!!o.deleted;r.userData.name=o.name;
   visualMeshes(r).forEach(x=>{if(o.color)x.material.color.setHex(o.color);x.material.opacity=o.opacity||1;x.material.transparent=x.material.opacity<1});
  }
  groups.clear();groupOf.clear();for(const g of data.groups||[]){groups.set(g.id,{...g,items:new Set(g.items.filter(id=>objects.has(id)))});for(const id of g.items)groupOf.set(id,g.id)}
  classFlags.clear();for(const [id,st] of data.classFlags||[])classFlags.set(id,st);
  for(const m of data.models||[]){const found=models.get(m.key);if(found){found.visible=m.visible;found.group.visible=m.visible}}
  if(data.camera){camera.position.fromArray(data.camera.position);orbit.target.fromArray(data.camera.target);orbit.update()}
  if(data.clip){$("clipEnabled").checked=data.clip.enabled;["x","y","z"].forEach(k=>$("clip"+k.toUpperCase()).value=data.clip[k]);applyClipping()}
  clearSelection();renderModels();renderClasses();
 }finally{muteHistory=false}
}
async function undo(){if(undoStack.length<2)return;redoStack.push(undoStack.pop());restoreView(JSON.parse(undoStack.at(-1).snapshot));setStatus("Rückgängig")}
async function redo(){if(!redoStack.length)return;const entry=redoStack.pop();restoreView(JSON.parse(entry.snapshot));undoStack.push(entry);setStatus("Wiederholen")}
function groupSelected(){
 const roots=activeRoots();if(roots.length<2)return setStatus("Mindestens zwei Objekte auswählen.",true);
 const ids=new Set(roots.map(r=>r.userData.lpId));
 for(const id of ids){const old=groupOf.get(id);if(old){const g=groups.get(old);g?.items.delete(id);if(g?.items.size<2){for(const a of g.items)groupOf.delete(a);groups.delete(old)}}}
 const id="GRP-"+(++groupIndex).toString().padStart(3,"0"),name=prompt("Name für Gruppe:","Gruppe "+groupIndex)||"Gruppe "+groupIndex;
 groups.set(id,{id,name,items:ids});for(const a of ids)groupOf.set(a,id);
 capture("Gruppe");renderObjects();updateUI();
}
function ungroup(){const gids=new Set([...selected].map(id=>groupOf.get(id)).filter(Boolean));for(const id of gids){const g=groups.get(id);for(const item of g.items)groupOf.delete(item);groups.delete(id)}capture("Gruppe aufgelöst");renderObjects();updateUI()}
function cloneObject(root){
 const id=nextKey("COPY"),copy=new THREE.Group();
 for(const source of root.children){const ch=source.clone(true);ch.traverse(x=>{if(x.isMesh){x.material=x.material.clone();x.geometry=x.geometry.clone()}});copy.add(ch)}
 copy.position.copy(root.position);copy.quaternion.copy(root.quaternion);copy.scale.copy(root.scale);
 copy.userData={...root.userData,lpId:id,sourceId:root.userData.sourceId||root.userData.lpId,isCopy:true,name:root.userData.name+" Kopie"};
 register(copy);return copy;
}
function duplicate(n=1,dx=1.5,dy=0){
 const rs=activeRoots();if(!rs.length)return;releasePivot();
 const made=[];
 for(let i=1;i<=n;i++)for(const r of rs){const cp=cloneObject(r);cp.position.x+=i*dx;cp.position.y+=i*dy;made.push(cp.userData.lpId)}
 if(rs.length>1&&made.length>1){
  const id="GRP-"+(++groupIndex).toString().padStart(3,"0");
  groups.set(id,{id,name:"Kopierte Gruppe",items:new Set(made)});for(const a of made)groupOf.set(a,id);
 }
 select(made);capture("Dupliziert");renderClasses();setStatus(made.length+" Kopien erstellt.");
}
function duplicateGrid(columns,rows,dx,dy){
 const rs=activeRoots();if(!rs.length)return;releasePivot();
 if(columns*rows*rs.length>500)return setStatus("Raster über 500 Objekte ist im Testbuild gesperrt.",true);
 const ids=[];
 for(let j=0;j<rows;j++)for(let i=0;i<columns;i++){
  if(i===0&&j===0)continue;
  for(const r of rs){
   const cp=cloneObject(r);cp.position.x+=i*dx;cp.position.y+=j*dy;ids.push(cp.userData.lpId);
  }
 }
 if(!ids.length)return;
 if(rs.length>1){
  const id="GRP-"+(++groupIndex).toString().padStart(3,"0");
  groups.set(id,{id,name:"Rastergruppe",items:new Set(ids)});
  for(const item of ids)groupOf.set(item,id);
 }
 select(ids);capture("Raster");renderClasses();setStatus(ids.length+" zusätzliche Rasterobjekte erstellt.");
}
function deleteSelected(){
 const rs=activeRoots();if(!rs.length)return;
 if(!confirm(rs.length+" ausgewählte Objekte im Konzept löschen? Die Original-IFC bleibt unverändert."))return;
 releasePivot();rs.forEach(r=>{r.userData.deleted=true;r.visible=false});selected.clear();controls.detach();
 capture("Gelöscht");updateUI();setStatus(rs.length+" Konzeptobjekte gelöscht (Undo möglich).");
}
function applySelectedProps(){
 const rs=activeRoots();if(!rs.length)return;releasePivot();
 const bb=new THREE.Box3();rs.forEach(r=>bb.union(worldBox(r)));
 const center=bb.getCenter(new THREE.Vector3()),size=bb.getSize(new THREE.Vector3());
 const wanted=new THREE.Vector3(num("posX",center.x),num("posY",center.y),num("posZ",center.z));
 const scaled=new THREE.Vector3(Math.max(.01,num("sizeX",size.x)),Math.max(.01,num("sizeY",size.y)),Math.max(.01,num("sizeZ",size.z)));
 const ratio=new THREE.Vector3(scaled.x/Math.max(size.x,.001),scaled.y/Math.max(size.y,.001),scaled.z/Math.max(size.z,.001));
 for(const r of rs){
  r.position.sub(center).multiply(ratio).add(wanted);
  r.scale.multiply(ratio);
 }
 rebuildTransform();capture("Maße");updateUI();renderObjects();
}
function applyColor(){
 const rs=activeRoots();const hex=parseInt($("objColor").value.slice(1),16);
 for(const r of rs)for(const m of visualMeshes(r))m.material.color.setHex(hex);
 capture("Farbe");updateUI();
}
function applyOpacity(){
 const pct=num("opacity",100);$("opacityValue").textContent=pct+"%";
 for(const r of activeRoots())for(const m of visualMeshes(r)){m.material.opacity=pct/100;m.material.transparent=pct<100;m.material.depthWrite=pct>=100}
 capture("Transparenz");
}
function alignByOffset(){
 const rs=activeRoots();if(!rs.length)return;releasePivot();
 for(const r of rs)r.position.add(new THREE.Vector3(num("offsetX"),num("offsetY"),num("offsetZ")));
 capture("Versetzen");updateUI();
}
function renderModels(){
 const box=$("modelList");box.innerHTML="";
 for(const m of models.values()){
  const row=document.createElement("div");row.className="item"+(activeModel===m.key?" current":"");
  const label=document.createElement("span");label.className="txt";label.textContent=m.name;label.title=m.name;
  const toggle=button(m.visible?"◉":"○",()=>{m.visible=!m.visible;m.group.visible=m.visible;capture("Sichtbarkeit");renderModels()}, "tiny");
  const sel=button("✓",()=>{activeModel=m.key;select(modelEntries(m.key).map(r=>r.userData.lpId));renderModels()},"tiny");
  row.append(toggle,label,sel);box.appendChild(row);
 }
}
function renderClasses(){
 const wrap=$("classList");wrap.innerHTML="";
 const counts=new Map();for(const r of objects.values()){const k=r.userData.classKey;counts.set(k,(counts.get(k)||0)+1)}
 for(const [id,count] of counts){
  const [modelKey,...cl]=id.split("|"),label=modelKey==="Eigene Layout-Objekte"?modelKey:cl.join("|")||id;
  const state=classFlags.get(id)||{visible:true,locked:false};const row=document.createElement("div");row.className="item";
  const text=document.createElement("span");text.className="txt";text.textContent=label+" ("+count+")";text.title=id;
  row.append(text,button(state.visible?"◉":"○",()=>{state.visible=!state.visible;for(const r of objects.values())if(r.userData.classKey===id)r.visible=state.visible&&!r.userData.deleted;renderClasses();capture("Klasse sichtbar")},"tiny"),
   button(state.locked?"🔒":"🔓",()=>{state.locked=!state.locked;renderClasses()},"tiny"));
  wrap.appendChild(row);
 }
}
function renderGroups(){
 const target=$("groupList");if(!target)return;target.innerHTML="";
 for(const group of groups.values()){
  const row=document.createElement("div");row.className="item";
  const name=document.createElement("span");name.className="txt";name.textContent=group.name+" ("+group.items.size+")";name.title=group.id;
  const eye=button(group.hidden?"○":"◉",()=>{
   group.hidden=!group.hidden;
   if(group.hidden){group.beforeVisibility={};for(const id of group.items){const r=objects.get(id);if(r){group.beforeVisibility[id]=r.visible;r.visible=false}}}
   else{for(const id of group.items){const r=objects.get(id);if(r)r.visible=!r.userData.deleted&&(group.beforeVisibility?.[id]!==false)}}
   clearSelection();capture("Gruppe sichtbar");renderGroups();
  },"tiny");
  const pick=button("✓",()=>select([...group.items]),"tiny");
  row.append(name,eye,pick);target.appendChild(row);
 }
}
function renderObjects(){
 renderGroups();
 const term=$("objectSearch").value.trim().toLowerCase();const panel=$("objectList");panel.innerHTML="";
 let shown=0;for(const r of objects.values()){
  if(term&&!r.userData.name.toLowerCase().includes(term))continue;if(shown++>120)break;
  const row=document.createElement("div");row.className="item"+(selected.has(r.userData.lpId)?" current":"");
  const t=document.createElement("span");t.className="txt";t.textContent=r.userData.name+(r.userData.deleted?" [gelöscht]":"");t.title=r.userData.ifcClass;
  row.append(t,button("◎",()=>{select([r.userData.lpId]);zoomTo([r])},"tiny"));
  row.onclick=e=>{if(e.target.tagName==="BUTTON")return;select([r.userData.lpId],e.shiftKey,e.altKey)};
  panel.appendChild(row);
 }
}
function zoomTo(rs){
 const b=new THREE.Box3();rs.forEach(r=>b.union(worldBox(r)));if(b.isEmpty())return;
 const center=b.getCenter(new THREE.Vector3()),size=b.getSize(new THREE.Vector3()),distance=Math.max(size.length(),5);
 orbit.target.copy(center);camera.position.set(center.x+distance*.8,center.y-distance,center.z+distance*.9);orbit.update();
}
function fitAll(){const rs=[...objects.values()].filter(isSelectable);zoomTo(rs)}
function topView(){const b=new THREE.Box3();[...objects.values()].filter(isSelectable).forEach(r=>b.union(worldBox(r)));const center=b.getCenter(new THREE.Vector3()),sz=b.getSize(new THREE.Vector3());const d=Math.max(sz.x,sz.y,10);camera.position.set(center.x,center.y,center.z+d*1.8);camera.up.set(0,1,0);orbit.target.copy(center);orbit.update();setTimeout(()=>camera.up.set(0,0,1),50)}
function applyClipping(){
 clipEnabled=$("clipEnabled").checked;
 clipPlanes[0].constant=num("clipX",50);clipPlanes[1].constant=num("clipY",50);clipPlanes[2].constant=num("clipZ",6);
 renderer.clippingPlanes=clipEnabled?clipPlanes:[];
}
function libraryInsert(kind){
 const d={machine:[4,2.5,2.5],rack:[3,1.2,3],forklift:[2.4,1.2,2],workplace:[2,1.4,1],wall:[5,.2,3],conveyor:[5,1,1]}[kind];
 const r=drawObject("box",new THREE.Vector3(orbit.target.x,orbit.target.y,d[2]/2),d,kind.toUpperCase()+" "+(itemIndex+1));
 for(const m of visualMeshes(r))m.material.color.setHex(COLORS[kind]||0x90abb7);
 select([r.userData.lpId]);capture("Bibliothek");renderObjects();
}
function captureModule(){
 const rs=activeRoots();if(!rs.length)return setStatus("Bitte Objekte oder Gruppe auswählen.",true);
 const b=new THREE.Box3();rs.forEach(r=>b.union(worldBox(r)));const center=b.getCenter(new THREE.Vector3());
 const entry={schema:"LEANNOVA-LP-V2-MODULE",name:prompt("Modulname","Eigenes Modul")||"Modul",pieces:rs.map(r=>{
  const bb=worldBox(r),size=bb.getSize(new THREE.Vector3()),p=bb.getCenter(new THREE.Vector3()).sub(center);
  return{name:r.userData.name,size:size.toArray(),offset:p.toArray(),color:visualMeshes(r)[0]?.material?.color?.getHex()||0xaabbcc}
 })};
 const data=JSON.stringify(entry,null,2);download(entry.name.replace(/[^\w-]/g,"_")+".lp-module.json",data,"application/json");
}
function importModule(e){
 const f=e.target.files?.[0];if(!f)return;
 f.text().then(t=>{const module=JSON.parse(t);if(module.schema!=="LEANNOVA-LP-V2-MODULE")throw Error("Kein LP-Modul");
  const made=[];for(const p of module.pieces){const s=p.size.map(v=>Math.max(v,.01)),xyz=p.offset||[0,0,0];const center=orbit.target.clone().add(new THREE.Vector3(...xyz));const r=drawObject("box",center,s,p.name);visualMeshes(r).forEach(m=>m.material.color.setHex(p.color));made.push(r.userData.lpId)}
  select(made);capture("Bibliotheksmodul");renderObjects();setStatus("Modul geladen: "+module.name);
 }).catch(err=>setStatus(err.message,true));e.target.value="";
}
function download(name,data,type){const u=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement("a");a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),3000)}
async function saveProject(){const data=toProject(true);download("LEANNOVA_LayoutPlanner_V2.lp.json",JSON.stringify(data),"application/json");setStatus("V2-Projekt mit IFC-Quelldaten gesichert.")}
async function loadProjectFile(e){
 const file=e.target.files?.[0];if(!file)return;try{
  const data=JSON.parse(await file.text());if(data.schema!=="LEANNOVA-LP-V2")throw Error("Unbekanntes LP-Projektformat");
  for(const m of [...models.values()]){for(const r of modelEntries(m.key))forget(r);m.group.removeFromParent();ifcApi?.CloseModel(m.handle);models.delete(m.key)}
  for(const r of [...objects.values()])forget(r);
  undoStack=[];redoStack=[];
  for(const m of data.models||[]){if(!m.source)throw Error("Quelldatei nicht eingebettet: "+m.name);const id=await addIFC(new TextEncoder().encode(m.source),m.name,m.trimble);
   const x=models.get(id);models.delete(id);x.key=m.key;models.set(m.key,x);
   for(const r of [...objects.values()].filter(r=>r.userData.modelKey===id)){
    objects.delete(r.userData.lpId);r.userData.modelKey=m.key;r.userData.lpId=m.key+":"+r.userData.expressID;r.userData.sourceId=r.userData.lpId;r.userData.classKey=m.key+"|"+r.userData.ifcClass;objects.set(r.userData.lpId,r);
   }
  }
  restoreView(data);capture("Projekt geöffnet");setStatus("V2-Projekt wiederhergestellt");
 }catch(err){setStatus("Projekt konnte nicht geladen werden: "+err.message,true)}finally{e.target.value=""}
}
function reviewExports(){setStatus("Prüfe IFC-Konzepte …");currentExports=[];const notes=[];
 const stand="V002_"+new Date().toISOString().replace(/[-:]/g,"").replace("T","_").slice(0,15);
 for(const m of models.values()){
  const roots=new Map(modelEntries(m.key).filter(r=>!r.userData.deleted).map(r=>[r.userData.lpId,r]));
  const deleted=modelEntries(m.key).filter(r=>r.userData.deleted);
  if(deleted.length){notes.push(m.name+": "+deleted.length+" Löschungen nicht IFC-konform exportiert; Datei gesperrt.");continue}
  if(!roots.size)continue;
  try{
   const result=buildIfcVariant({THREE,sourceText:m.source,allRoots:roots,releaseMultiPivot:releasePivot,basis:"identity"});
   const temp=ifcApi.OpenModel(new TextEncoder().encode(result.text),{COORDINATE_TO_ORIGIN:false});
   if(temp===-1)throw Error("Web-ifc Rückimport fehlgeschlagen");ifcApi.CloseModel(temp);
   const name=safeName(m.name.replace(/\.ifc$/i,""))+"_LP_"+stand+".ifc";
   currentExports.push({name,text:result.text,source:m});notes.push(name+" · exportiert");
  }catch(err){
   if(String(err.message||"").includes("keine geometrischen Änderungen")){
    const name=safeName(m.name.replace(/\.ifc$/i,""))+"_LP_"+stand+".ifc";
    currentExports.push({name,text:m.source,source:m});notes.push(name+" · unverändert übernommen");
   }
   else notes.push(m.name+": "+err.message);
  }
 }
 const additions=[...objects.values()].filter(r=>r.userData.kind==="draw"&&!r.userData.deleted);
 if(additions.length){
  try{
   const result=createSupplementIfc(THREE,additions);
   const temp=ifcApi.OpenModel(new TextEncoder().encode(result),{COORDINATE_TO_ORIGIN:false});
   if(temp===-1)throw Error("Web-ifc Rückimport fehlgeschlagen");ifcApi.CloseModel(temp);
   currentExports.push({name:"Layout-Ergaenzungen_LP_"+stand+".ifc",text:result,source:null});
   notes.push(additions.length+" neue Objekte in Ergänzungs-IFC");
  }catch(e){notes.push("Ergänzungs-IFC FEHLER: "+e.message)}
 }
 $("exportResult").innerHTML="";
 for(const t of currentExports){
  const b=button("↓ "+t.name,()=>download(t.name,t.text,"application/x-step"));b.style.width="100%";b.style.marginBottom="5px";$("exportResult").appendChild(b)
 }
 const p=document.createElement("p");p.textContent=notes.join(" | ")||"Keine Änderungen zum Export";
 $("exportResult").appendChild(p);$("sendTrimble").disabled=!trimbleConnected||!currentExports.length;
 setStatus(currentExports.length+" Konzept-IFCs geprüft. Ungestützte Funktionen siehe Status.");
}
function trimbleImport(event){
 const d=event.data;if(event.origin!==location.origin)return;
 if(d?.type==="LP_V2_IFCS"){
  const list=(d.models||[]).filter(m=>m.buffer instanceof ArrayBuffer);
  (async()=>{for(const m of list){try{await addIFC(new Uint8Array(m.buffer),m.name,m.trimble||{})}catch(e){console.warn(e)}}
    setStatus(list.length+" Trimble-IFCs übergeben.");trimbleConnected=true;})()
 }
 if(d?.type==="LP_V2_EXPORT_STATUS")setStatus(d.message,!d.ok);
}
window.addEventListener("message",trimbleImport);
function bind(){
 document.querySelectorAll(".fold").forEach(b=>b.onclick=()=>b.closest(".sec").classList.toggle("collapsed"));
 $("localInput").onchange=async e=>{for(const f of Array.from(e.target.files||[])){try{await addIFC(new Uint8Array(await f.arrayBuffer()),f.name)}catch(_){}}e.target.value=""};
 $("addLocal").onclick=()=>$("localInput").click();
 $("loadTrimble").onclick=()=>{const opener=window.opener;if(!opener)return setStatus("Bitte V2 aus der Trimble-Erweiterung öffnen.",true);opener.postMessage({type:"LP_V2_MODEL_REQUEST"},location.origin)};
 $("modeMove").onclick=()=>setMode("translate");$("modeRotate").onclick=()=>setMode("rotate");$("modeScale").onclick=()=>setMode("scale");$("modeSelect").onclick=()=>setMode("select");
 document.querySelectorAll("[data-draw]").forEach(b=>b.onclick=()=>chooseDraw(b.dataset.draw));
 $("drawCancel").onclick=()=>{drawKind=null;drawStart=null;clearPreview()};
 $("copyButton").onclick=()=>duplicate(1,1.5,1.5);$("repeatButton").onclick=()=>duplicateGrid(Math.min(150,Math.max(1,num("repeatN",10))),Math.min(40,Math.max(1,num("repeatRows",1))),num("repeatX",1.5),num("repeatY",1.5));
 $("deleteButton").onclick=deleteSelected;$("groupButton").onclick=groupSelected;$("ungroupButton").onclick=ungroup;
 $("undoTop").onclick=undo;$("redoTop").onclick=redo;$("selectClear").onclick=clearSelection;
 $("viewTop").onclick=topView;$("fitTop").onclick=fitAll;$("fitSelected").onclick=()=>zoomTo(activeRoots());
 $("alignBtn").onclick=alignByOffset;$("applyTransformBtn").onclick=applySelectedProps;
 $("renameBtn").onclick=()=>{const n=$("objectName").value.trim();if(!n)return;const roots=activeRoots();for(const r of roots)r.userData.name=n;capture("Benannt");updateUI()};
 $("applyColor").onclick=applyColor;$("opacity").onchange=applyOpacity;
 $("toggleSelected").onclick=()=>{for(const r of activeRoots())r.visible=false;clearSelection();capture("Ausblenden")};
 $("objectSearch").oninput=renderObjects;
 $("measureBtn").onclick=()=>{measureStart=false;drawKind=null;setStatus("Zwei Punkte bzw. Objekte anklicken …")};
 $("clipEnabled").onchange=applyClipping;["clipX","clipY","clipZ"].forEach(x=>$(x).onchange=applyClipping);
 $("clipReset").onclick=()=>{$("clipEnabled").checked=false;applyClipping();fitAll()};
 document.querySelectorAll("[data-lib]").forEach(b=>b.onclick=()=>libraryInsert(b.dataset.lib));
 $("saveModuleBtn").onclick=captureModule;$("loadModuleBtn").onclick=()=>$("libImport").click();$("libImport").onchange=importModule;
 $("projectSaveTop").onclick=saveProject;$("saveProject").onclick=saveProject;
 $("loadProject").onclick=()=>$("projectInput").click();$("projectInput").onchange=loadProjectFile;
 $("exportTop").onclick=reviewExports;$("exportBtn").onclick=reviewExports;
 $("sendTrimble").onclick=()=>{if(!trimbleConnected)return;const list=currentExports.map(t=>({name:t.name,buffer:new TextEncoder().encode(t.text).buffer,source:t.source?.trimble||null}));
 if(!confirm(list.length+" neue IFC-Dateien unter Layout-Planner in Trimble Connect speichern? Originaldateien bleiben unverändert."))return;
 window.opener?.postMessage({type:"LP_V2_EXPORT_FILES",files:list},location.origin);setStatus("Trimble-Exportauftrag übermittelt.")};
 $("pointcloudLoad").onclick=()=>{const url=$("pointcloudUrl").value.trim();$("pointcloudInfo").textContent=url?"Server-Livezugriff noch nicht eingerichtet. Erforderlich: VPN-HTTPS-Tileserver (Potree/COPC), CORS und georeferenzierte Metadaten.":"Bitte VPN-HTTPS-Streamingadresse angeben.";setStatus("E57-Streaming: Serveranbindung technisch offen",true)};
 $("pointcloudHide").onclick=()=>{if(pointcloud){pointcloud.removeFromParent();pointcloud=null}};
 window.addEventListener("keydown",e=>{if(e.target instanceof HTMLInputElement)return;
  if(e.key==="Escape"){drawKind=null;drawStart=null;clearPreview();clearSelection()}
  if(e.key.toLowerCase()==="g")setMode("translate");
  if(e.key.toLowerCase()==="r")setMode("rotate");
  if(e.key.toLowerCase()==="s")setMode("scale");
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();undo()}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="y"){e.preventDefault();redo()}
 });
}
function tick(){requestAnimationFrame(tick);orbit.update();renderer.render(scene,camera)}
new ResizeObserver(()=>{const w=viewer.clientWidth,h=viewer.clientHeight||1;if(!w)return;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()}).observe(viewer);
bind();tick();
$("testSummary").innerHTML="V2-Teststand: Import/Zeichnen/Gruppen/Bewegen/Skalieren/Messen/Projektsicherung implementiert. IFC-Export, Mehrmodell-Rundlauf und Farbexport in Trimble noch live zu prüfen. E57-Firmenserver und Revit noch offen.";
if(new URLSearchParams(location.search).get("source")==="trimble"){
 setStatus("Warte auf mehrere IFC-Fachmodelle aus Trimble …");
 window.opener?.postMessage({type:"LP_V2_READY"},location.origin);
}else loadDemo();
