// LEANNOVA LP F10 - IFC2X3/IFC4 STEP variant exporter.
// Never mutates the input IFC; refuses unsupported changes rather than omitting them.
const GUID_CHARS="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
function guid22(){
 const b=new Uint8Array(16);crypto.getRandomValues(b);
 const nums=[b[0],b[1]*65536+b[2]*256+b[3],b[4]*65536+b[5]*256+b[6],b[7]*65536+b[8]*256+b[9],b[10]*65536+b[11]*256+b[12],b[13]*65536+b[14]*256+b[15]];
 return nums.map((n,i)=>{let s="",k=i?4:2;while(k--){s=GUID_CHARS[n%64]+s;n=Math.floor(n/64)}return s}).join("");
}
function stepQuote(s){return "'"+String(s||"").replace(/'/g,"''")+"'";}
function fail(s){throw new Error("IFC-Export gestoppt: "+s)}
function splitArgs(s){
 const a=[];let start=0,depth=0,inQuote=false;
 for(let i=0;i<s.length;i++){
  const ch=s[i];
  if(ch==="'"){
   if(inQuote&&s[i+1]==="'"){i++;continue}
   inQuote=!inQuote;continue;
  }
  if(inQuote)continue;
  if(ch==="(")depth++;
  if(ch===")")depth--;
  if(ch===","&&depth===0){a.push(s.slice(start,i).trim());start=i+1}
 }
 a.push(s.slice(start).trim());return a;
}
function parseStep(text){
 const beginMatch=/\bDATA\s*;/i.exec(text);
 if(!beginMatch||!text.trimStart().startsWith("ISO-10303-21"))fail("Die Quelldatei ist keine gültige STEP-IFC.");
 const begin=beginMatch.index+beginMatch[0].length;
 const end=text.indexOf("ENDSEC;",begin);
 if(end<0)fail("DATA-Ende fehlt.");
 const source=text.slice(begin,end),entities=new Map();
 let pos=0;
 while(pos<source.length){
  const next=source.indexOf("#",pos);if(next<0)break;
  const match=/^#(\d+)\s*=\s*([A-Za-z0-9_]+)\s*\(/.exec(source.slice(next));
  if(!match){pos=next+1;continue}
  const id=Number(match[1]),type=match[2].toUpperCase();
  const argStart=next+match[0].length;
  let depth=1,quote=false,i=argStart;
  for(;i<source.length;i++){
   const ch=source[i];
   if(ch==="'"){if(quote&&source[i+1]==="'"){i++;continue}quote=!quote;continue}
   if(quote)continue;
   if(ch==="(")depth++;
   else if(ch===")"){depth--;if(depth===0)break}
  }
  if(depth!==0||source.slice(i+1).trimStart()[0]!==";")fail("STEP-Entity #"+id+" ist unvollständig.");
  let endPos=i+1;while(/\s/.test(source[endPos]||"")&&endPos<source.length)endPos++;
  if(source[endPos]!==";")fail("Fehlendes Semikolon in #"+id);
  endPos++;
  if(entities.has(id))fail("Doppelte Entity #"+id);
  entities.set(id,{id,type,args:splitArgs(source.slice(argStart,i)),raw:source.slice(next,endPos),start:begin+next,end:begin+endPos});
  pos=endPos;
 }
 if(!entities.size)fail("Keine STEP-Entities gefunden.");
 return{entities,begin,end,maxId:Math.max(...entities.keys())};
}
function refId(ref){
 const m=/^#(\d+)$/.exec(String(ref||"").trim());return m?Number(m[1]):null;
}
function formatNum(v){
 if(!Number.isFinite(v))fail("Nicht-endliche Koordinate.");
 if(Math.abs(v)<1e-10)v=0;
 let s=Number(v.toFixed(9)).toString();
 if(/e/i.test(s))s=v.toFixed(9).replace(/0+$/,"").replace(/\.$/,"");
 if(!s.includes("."))s+=".";
 return s;
}
function vecText(v){return "("+[v.x,v.y,v.z].map(formatNum).join(",")+")";}
function readTriplet(p,rec){
 if(!rec)fail("IFC-Punkt/Richtung #"+p+" fehlt.");
 if(!["IFCCARTESIANPOINT","IFCDIRECTION"].includes(rec.type))fail("Unerwarteter IFC-Koordinatentyp #"+p);
 const a=splitArgs(rec.args[0].replace(/^\(/,"").replace(/\)$/,""));
 const v=a.map(Number);
 if(v.length===2)v.push(0);
 if(v.length!==3||v.some(n=>!Number.isFinite(n)))fail("Ungültige Koordinate in #"+p);
 return v;
}
function placementGlobal(THREE,parsed,id,seen=new Set()){
 if(id==null)return new THREE.Matrix4().identity();
 if(seen.has(id))fail("Zyklische IFC-Objektplatzierung #"+id);
 seen.add(id);
 const rec=parsed.entities.get(id);
 if(!rec||rec.type!=="IFCLOCALPLACEMENT")fail("Nicht unterstützte Objektplatzierung #"+id);
 const axis=parsed.entities.get(refId(rec.args[1]));
 if(!axis||!(axis.type==="IFCAXIS2PLACEMENT3D"||axis.type==="IFCAXIS2PLACEMENT2D"))fail("Ungültige Achsenplatzierung bei #"+id);
 const xyz=readTriplet(refId(axis.args[0]),parsed.entities.get(refId(axis.args[0])));
 let z=new THREE.Vector3(0,0,1),x=new THREE.Vector3(1,0,0);
 if(axis.type==="IFCAXIS2PLACEMENT3D"){
  const za=refId(axis.args[1]),xa=refId(axis.args[2]);
  if(za!=null)z.fromArray(readTriplet(za,parsed.entities.get(za)));
  if(xa!=null)x.fromArray(readTriplet(xa,parsed.entities.get(xa)));
 }else{
  const xa=refId(axis.args[1]);
  if(xa!=null)x.fromArray(readTriplet(xa,parsed.entities.get(xa)));
  x.z=0;
 }
 if(z.lengthSq()<1e-12||x.lengthSq()<1e-12)fail("IFC-Achse ohne Länge #"+id);
 z.normalize();x.addScaledVector(z,-x.dot(z));
 if(x.lengthSq()<1e-12)fail("IFC-Achsen sind parallel #"+id);
 x.normalize();const y=new THREE.Vector3().crossVectors(z,x).normalize();
 const local=new THREE.Matrix4().makeBasis(x,y,z);
 local.setPosition(new THREE.Vector3().fromArray(xyz));
 const parent=refId(rec.args[0]);
 const result=placementGlobal(THREE,parsed,parent,seen).multiply(local);
 seen.delete(id);return result;
}
function matrixForRoot(THREE,r){
 r.updateWorldMatrix(true,false);
 const p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();
 r.matrixWorld.decompose(p,q,s);
 if([s.x,s.y,s.z].some(x=>Math.abs(x-1)>1e-5))fail("Objektskalierung wird noch nicht unterstützt: "+r.userData.name);
 return new THREE.Matrix4().compose(p,q,new THREE.Vector3(1,1,1));
}
function hasDelta(THREE,base,current){
 const d=new THREE.Matrix4().multiplyMatrices(current,base.clone().invert());
 const pos=new THREE.Vector3(),q=new THREE.Quaternion(),scale=new THREE.Vector3();
 d.decompose(pos,q,scale);
 return pos.length()>1e-5||q.angleTo(new THREE.Quaternion())>1e-6||Math.max(Math.abs(scale.x-1),Math.abs(scale.y-1),Math.abs(scale.z-1))>1e-6;
}
// Web-ifc viewer transforms are tested by opening the generated IFC again.
function viewerDeltaToIfc(THREE,delta,basis){
 const axes=new THREE.Matrix4().identity();
 if(basis==="xPlus90")axes.makeRotationX(Math.PI/2);
 else if(basis==="xMinus90")axes.makeRotationX(-Math.PI/2);
 else if(basis!=="identity")fail("Unbekannte Koordinatenbasis: "+basis);
 return axes.clone().invert().multiply(delta).multiply(axes);
}
export function buildIfcVariant({THREE,sourceText,allRoots,releaseMultiPivot,onValidated,basis="identity"}){

 releaseMultiPivot?.();
 const parsed=parseStep(sourceText);
 const e=parsed.entities;
 const changedEntities=new Map(),appended=[];
 let next=parsed.maxId+1;
 function add(type,args){const id=next++;appended.push("#"+id+"="+type+"("+args.join(",")+");");return id}
 function edit(rec,args){changedEntities.set(rec.id,"#"+rec.id+"="+rec.type+"("+args.join(",")+");")}
 const existingGuids=new Set();
 for(const rec of e.values()){
  if(rec.args.length&&/^'[0-9A-Za-z_$]{22}'$/.test(rec.args[0]))existingGuids.add(rec.args[0].slice(1,-1));
 }
 function uniqueGuid(){
  let g;do{g=guid22()}while(existingGuids.has(g));existingGuids.add(g);return g;
 }
 function placeMatrix(mat){
  const p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();mat.decompose(p,q,s);
  if([s.x,s.y,s.z].some(v=>Math.abs(v-1)>1e-5))fail("Schräge Skalierung/Spiegelung nicht exportierbar.");
  const z=new THREE.Vector3(0,0,1).applyQuaternion(q).normalize();
  const x=new THREE.Vector3(1,0,0).applyQuaternion(q).normalize();
  const pt=add("IFCCARTESIANPOINT",[vecText(p)]);
  const axis=add("IFCDIRECTION",[vecText(z)]),ref=add("IFCDIRECTION",[vecText(x)]);
  const ax=add("IFCAXIS2PLACEMENT3D",["#"+pt,"#"+axis,"#"+ref]);
  return add("IFCLOCALPLACEMENT",["$","#"+ax]);
 }
 function originalRecord(r){
  const id=Number(r.userData.expressID||0),rec=e.get(id);
  if(!rec||rec.args.length<7)fail("Kein exportfähiges IFC-Produkt: "+r.userData.name);
  if(rec.args[5]!=="$"&&refId(rec.args[5])==null)fail("Objektplatzierung nicht lesbar: "+r.userData.name);
  return rec;
 }
 const originals=new Map(),copies=[];
 for(const [id,r] of allRoots){
  if(r.userData.isCopy)copies.push(r);else originals.set(id,r);
 }
 let modified=0;
 const geometryTargets=[];
 const working=new Map();
 for(const [id,r] of originals){
  const current=matrixForRoot(THREE,r);
  const initial=r.userData.lpBaseWorldMatrix?new THREE.Matrix4().fromArray(r.userData.lpBaseWorldMatrix):null;
  if(!initial)fail("Ausgangsposition fehlt für "+r.userData.name);
  const rec=originalRecord(r);
  const changed=hasDelta(THREE,initial,current);
  const startPlace=placementGlobal(THREE,parsed,refId(rec.args[5]));
  working.set(id,{rec,initial,current,startPlace});
  if(changed){
   const viewerDelta=new THREE.Matrix4().multiplyMatrices(current,initial.clone().invert());
   const delta=viewerDeltaToIfc(THREE,viewerDelta,basis);
   const newPlace=placeMatrix(new THREE.Matrix4().multiplyMatrices(delta,startPlace));
   const args=[...rec.args];args[5]="#"+newPlace;
   edit(rec,args);modified++;geometryTargets.push({lpId:id,guid:r.userData.guid,kind:"changed"});
  }
 }
 const containedBy=new Map();
 for(const rec of e.values())if(rec.type==="IFCRELCONTAINEDINSPATIALSTRUCTURE"){
  const args=rec.args;
  if(args.length<6)continue;
  const list=args[4],refs=Array.from(list.matchAll(/#(\d+)/g),m=>Number(m[1]));
  for(const id of refs)containedBy.set(id,rec);
 }
 let copyCount=0;
 const containedCopies=new Map();
 for(const copy of copies){
  const sourceId=copy.userData.sourceId;
  const src=originals.get(sourceId);
  if(!src)fail("Kopie ohne Originalbezug: "+copy.userData.name);
  const w=working.get(sourceId);
  if(!w)fail("Kopierquelle nicht gefunden: "+copy.userData.name);
  const containment=containedBy.get(w.rec.id);
  if(!containment)fail("Keine räumliche IFC-Zuordnung für Kopie "+copy.userData.name);
  const final=matrixForRoot(THREE,copy);
  const viewerDelta=new THREE.Matrix4().multiplyMatrices(final,w.initial.clone().invert());
  const delta=viewerDeltaToIfc(THREE,viewerDelta,basis);
  const newPlace=placeMatrix(new THREE.Matrix4().multiplyMatrices(delta,w.startPlace));
  const newGuid=uniqueGuid(),args=[...w.rec.args];
  args[0]=stepQuote(newGuid);
  args[2]=stepQuote(copy.userData.name||"Layout Planner Kopie");
  args[5]="#"+newPlace;
  const copyId=add(w.rec.type,args);
  if(!containedCopies.has(containment.id))containedCopies.set(containment.id,[]);
  containedCopies.get(containment.id).push(copyId);copyCount++;geometryTargets.push({lpId:copy.userData.lpId,guid:newGuid,kind:"copy"});
 }
 for(const [relId,ids] of containedCopies){
  const rec=e.get(relId),args=[...rec.args];
  const old=args[4].trim();
  if(!old.startsWith("(")||!old.endsWith(")"))fail("IFC-Raumzuordnung ungültig #"+relId);
  args[4]=old.slice(0,-1)+(old.length>2?",":"")+ids.map(id=>"#"+id).join(",")+")";
  edit(rec,args);
 }
 if(!modified&&!copyCount)fail("Es gibt keine geometrischen Änderungen oder Kopien.");
 let result=sourceText;
 const changes=[...changedEntities.values()];
 const patches=[...changedEntities].map(([id,text])=>({rec:e.get(id),text})).sort((a,b)=>b.rec.start-a.rec.start);
 for(const patch of patches)result=result.slice(0,patch.rec.start)+patch.text+result.slice(patch.rec.end);
 const inserted=appended.join("\n");
 const insertAt=result.indexOf("ENDSEC;",parsed.begin);
 result=result.slice(0,insertAt)+"\n"+inserted+"\n"+result.slice(insertAt);
 const verify=parseStep(result);
 if(verify.entities.size!==parsed.entities.size+appended.length)fail("STEP-Entity-Anzahl nach Export falsch.");
 for(const [id,rec] of verify.entities)for(const match of rec.raw.matchAll(/#(\d+)/g)){
  const target=Number(match[1]);if(!verify.entities.has(target))fail("Ungültige IFC-Referenz #"+target+" in #"+id);
 }
 const report={originalObjects:originals.size,modified,copyCount,entities:verify.entities.size,addedEntities:appended.length,byteCount:new TextEncoder().encode(result).length,basis,geometryTargets};
 if(typeof onValidated==="function")onValidated(result,report);
 return{text:result,report};
}
