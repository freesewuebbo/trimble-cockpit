// LEANNOVA Layout Planner F11 - strict "new file only" Trimble Connect Core upload.
// Runs exclusively inside the Trimble extension's same-origin launcher.
// No token is sent to the standalone planner; no PUT/PATCH/DELETE on existing files.
function requiredString(value,label){
 const v=String(value??"").trim();
 if(!v||v==="undefined"||v==="null")throw new Error(label+" fehlt.");
 return v;
}
function objectOf(o){return o&&typeof o==="object"&&!Array.isArray(o)?o:{}}
function unwrap(v){const o=objectOf(v);return Object.keys(objectOf(o.data)).length?o.data:o}
function first(...values){for(const v of values){if(typeof v==="string"&&v.trim())return v.trim()}return null}
function regionHosts(location){
 const p=String(location||"").toLowerCase();
 const eu="https://app21.connect.trimble.com/tc/api/2.0";
 const us="https://app.connect.trimble.com/tc/api/2.0";
 const asia="https://app31.connect.trimble.com/tc/api/2.0";
 const order=p.includes("eu")||p.includes("europe")?[eu,us,asia]:
  p.includes("asia")||p.includes("ap-")||p.includes("singapore")?[asia,eu,us]:
  p.includes("us")||p.includes("na")||p.includes("north america")?[us,eu,asia]:[eu,us,asia];
 return [...new Set(order)];
}
function messageFromError(o){
 if(typeof o==="string")return o.slice(0,400);
 const v=objectOf(o);
 return String(v.message||v.error_description||v.error||v.detail||v.title||JSON.stringify(v)||"Unbekannter API-Fehler").slice(0,500);
}
async function rest(base,token,path,{method="GET",body}={}){
 if(!/^https:\/\/(?:app|app21|app31)\.connect\.trimble\.com\/tc\/api\/2\.0$/.test(base))
  throw new Error("Nicht vertrauenswürdiger Trimble-API-Host.");
 const url=base+path;
 const h={Authorization:"Bearer "+token,Accept:"application/json"};
 if(body!==undefined)h["Content-Type"]="application/json";
 let response;
 try{
  response=await fetch(url,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body),credentials:"omit",cache:"no-store"});
 }catch(e){throw new Error("Trimble-API Netzwerk/CORS-Fehler: "+e.message)}
 const text=await response.text().catch(()=>"");
 let result=null;try{result=text?JSON.parse(text):null}catch(_){result={message:text.slice(0,500)}}
 if(!response.ok){
  const e=new Error("Trimble "+method+" "+path.split("?")[0]+" HTTP "+response.status+": "+messageFromError(result));
  e.status=response.status;throw e;
 }
 return result;
}
function entityId(o){return first(o.id,o.fileId,o.Id)}
function extractEntries(response){
 if(Array.isArray(response))return response;
 const a=objectOf(response),b=objectOf(a.data);
 if(Array.isArray(a.items))return a.items;
 if(Array.isArray(b.items))return b.items;
 // Fails closed: empty array is safe only if the API actually returned an array.
 throw new Error("Ordnerinhalt konnte nicht eindeutig gelesen werden. Upload zur Sicherheit gestoppt.");
}
async function locateSource(accessToken,projectId,sourceFileId,location){
 let errs=[];
 for(const base of regionHosts(location)){
  try{
   const raw=await rest(base,accessToken,"/files/"+encodeURIComponent(sourceFileId));
   const f=unwrap(raw),id=entityId(f),parent=first(f.parentId,f.folderId);
   if(id&&id!==sourceFileId)throw new Error("IFC-Datei-ID weicht vom ausgewählten Modell ab.");
   const actualProject=first(f.projectId,objectOf(f.project).id);
   if(actualProject&&actualProject!==projectId)throw new Error("Quelldatei liegt in einem anderen Trimble-Projekt.");
   if(!parent)throw new Error("Zielordner der Quelldatei fehlt in Trimble-Dateimetadaten.");
   return{base,source:f,folderId:parent};
  }catch(e){errs.push(base.replace(/https?:\/\//,"")+": "+e.message)}
 }
 throw new Error("Quelldatei/Region nicht eindeutig gefunden: "+errs.join(" | ").slice(0,900));
}
async function assertNewName(base,token,folderId,fileName,sourceFileId){
 const result=await rest(base,token,"/folders/"+encodeURIComponent(folderId)+"/items?tokenThumburl=false");
 const items=extractEntries(result);
 for(const x of items){
  const name=first(x.name,x.title);
  if(name&&name.normalize("NFKC").toLocaleLowerCase()===fileName.normalize("NFKC").toLocaleLowerCase())
   throw new Error("Zieldatei existiert bereits. Abbruch ohne Überschreiben: "+fileName);
 }
 if(!items.some(x=>entityId(x)===sourceFileId)){
  // Source may be hidden/checked out in the tree. We have independently verified source.parentId.
  // This is informational, not a reason to assume a different folder.
 }
 return true;
}
function readUploadInit(response){
 const p=unwrap(response),sources=[p,...(Array.isArray(p.contents)?p.contents:[])];
 const id=first(p.uploadId,p.UploadId);
 let url=null;
 for(const s of sources){
  const a=objectOf(s);
  url=first(a.uploadURL,a.uploadUrl,a.url,a.putUrl);
  if(url)break;
 }
 if(!id||!url)throw new Error("Trimble hat keine Upload-ID oder Upload-URL geliefert.");
 const parsed=new URL(url);
 if(parsed.protocol!=="https:")throw new Error("Unsichere Upload-URL von Trimble verworfen.");
 return{id,url:parsed.toString()};
}
function looksLikeIfc(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.byteLength<64)return false;
 const begin=new TextDecoder("utf-8").decode(bytes.slice(0,256)).replace(/^\uFEFF/,"").trimStart();
 const end=new TextDecoder("utf-8").decode(bytes.slice(Math.max(0,bytes.length-512))).trim();
 return begin.startsWith("ISO-10303-21;")&&end.includes("END-ISO-10303-21;");
}
export async function uploadNewIfcVariant({
 accessToken,projectId,projectLocation,sourceFileId,sourceVersionId,sourceName,
 targetName,buffer,onProgress=()=>{}
}){
 const token=requiredString(accessToken,"Trimble-Zugriffstoken");
 const pid=requiredString(projectId,"Trimble-Projekt-ID");
 const sid=requiredString(sourceFileId,"Original-IFC-ID");
 const name=requiredString(targetName,"Neuer IFC-Dateiname");
 const original=requiredString(sourceName,"Original-Dateiname");
 if(!/^[^\/\\<>:"|?*\x00-\x1f]{1,200}\.ifc$/i.test(name))
  throw new Error("Ungültiger neuer IFC-Dateiname.");
 if(name.toLocaleLowerCase()===original.toLocaleLowerCase())
  throw new Error("Quelldateiname und Zieldateiname sind identisch.");
 if(!/(?:_LP_).+\.ifc$/i.test(name))
  throw new Error("Nur neue LP-Planungsvarianten dürfen hochgeladen werden.");
 const bytes=buffer instanceof ArrayBuffer?new Uint8Array(buffer):buffer;
 if(!looksLikeIfc(bytes))throw new Error("Upload abgebrochen: IFC-Dateisignatur ungültig.");
 if(bytes.byteLength>250*1024*1024)throw new Error("IFC größer als 250 MB: direkter Upload zunächst gesperrt.");
 onProgress("Trimble-Quelldatei und Projekt werden geprüft …");
 const {base,source,folderId}=await locateSource(token,pid,sid,projectLocation);
 if(sourceVersionId&&source.versionId&&String(source.versionId)!==String(sourceVersionId)){
  // Only informational: source may have a new version, but original file must not be modified.
  onProgress("Die Quelldatei hat eine neuere Version; eine neue LP-Datei wird separat angelegt …");
 }
 onProgress("Prüfe Zielordner und bestehenden Dateinamen …");
 await assertNewName(base,token,folderId,name,sid);
 onProgress("Upload wird in Trimble vorbereitet …");
 // No currentVersionId/If-Match: never request an update to an existing model.
 const initiated=await rest(base,token,"/files/fs/initiate",{method:"POST",body:{
  parentId:folderId,parentType:"FOLDER",name
 }});
 const {id:uploadId,url:uploadUrl}=readUploadInit(initiated);
 onProgress("Neue IFC wird in Trimble-Speicher übertragen …");
 let put;
 try{
  put=await fetch(uploadUrl,{method:"PUT",body:bytes,
   headers:{"Content-Type":"application/octet-stream"},credentials:"omit"});
 }catch(e){throw new Error("Binär-Upload fehlgeschlagen (CORS/Netzwerk): "+e.message)}
 if(!put.ok)throw new Error("Binär-Upload fehlgeschlagen: HTTP "+put.status);
 onProgress("Trimble bestätigt die neue IFC-Datei …");
 // An indeterminate commit response is NOT retried: avoids a duplicate or unintended action.
 const committed=await rest(base,token,"/files/fs/commit",{method:"POST",body:{uploadId}});
 const doc=unwrap(committed);
 let newId=entityId(doc),versionId=first(doc.versionId,doc.latestVersionId);
 if(newId&&newId===sid)throw new Error("Sicherheitsprüfung: Trimble meldet Originaldatei statt einer neuen Datei.");
 onProgress("Prüfe, ob die neue Datei tatsächlich angelegt wurde …");
 // Resolve a possibly absent ID by re-reading the folder rather than claiming success blindly.
 const items=extractEntries(await rest(base,token,"/folders/"+encodeURIComponent(folderId)+"/items?tokenThumburl=false"));
 const exact=items.find(x=>String(x.name||x.title||"")===name);
 if(!exact){
  throw new Error("Upload bestätigt, aber neue Datei noch nicht in der Ordnerliste sichtbar. Bitte im Projekt prüfen; nicht erneut klicken.");
 }
 const visibleId=entityId(exact);
 if(visibleId===sid)throw new Error("Sicherheitsstopp: Die neue Datei hat die ID der Original-IFC.");
 if(newId&&visibleId&&visibleId!==newId)
  throw new Error("Upload nicht eindeutig: ID aus Commit stimmt nicht mit Ordnerliste überein.");
 newId=newId||visibleId;
 versionId=versionId||first(exact.versionId,exact.latestVersionId);
 if(!newId)throw new Error("Neue IFC vorhanden, aber Datei-ID nicht bestätigt.");
 return{ok:true,projectId:pid,folderId,fileId:newId,versionId,name,bytes:bytes.length};
}
