// LEANNOVA Layout Planner F12 - original IFC source download from Trimble Connect Core API.
// The Viewer Workspace blob may be TRB8 (rendering cache), not the uploaded IFC.
// A signed, read-only Core API download retrieves the original STEP-IFC.
const BASES=[
 "https://app21.connect.trimble.com/tc/api/2.0", // EU
 "https://app.connect.trimble.com/tc/api/2.0", // North America / master
 "https://app31.connect.trimble.com/tc/api/2.0" // Asia
];
function str(v){return typeof v==="string"&&v.trim()?v.trim():null}
function obj(v){return v&&typeof v==="object"&&!Array.isArray(v)?v:{}}
function pick(...v){for(const x of v){const s=str(x);if(s)return s}return null}
function msg(v){
 const o=obj(v);
 return String(o.error_description||o.message||o.error||o.detail||o.title||"unbekannte Antwort").slice(0,380);
}
function roots(region){
 const r=String(region||"").toLowerCase();
 const prefer=r.includes("eu")||r.includes("europe")||r.includes("app21")?BASES[0]:
  r.includes("asia")||r.includes("app31")?BASES[2]:r.includes("us")||r.includes("north")?BASES[1]:BASES[0];
 return [prefer,...BASES.filter(x=>x!==prefer)];
}
async function jsonGet(base,path,token){
 if(!BASES.includes(base))throw new Error("Nicht unterstützter Trimble-Endpunkt.");
 let res;
 try{
  res=await fetch(base+path,{
   headers:{Authorization:"Bearer "+token,Accept:"application/json"},
   credentials:"omit",cache:"no-store"
  });
 }catch(e){throw new Error("Netzwerk/CORS: "+e.message)}
 const body=await res.text().catch(()=>"");
 let data=null;try{data=body?JSON.parse(body):null}catch(_){data={message:body.slice(0,200)}}
 if(!res.ok){
  const err=new Error("HTTP "+res.status+" "+msg(data));
  err.status=res.status;throw err;
 }
 return data;
}
function unpack(v){
 const a=obj(v),b=obj(a.data);
 return Object.keys(b).length?b:a;
}
function trustedSignedUrl(v){
 const url=str(v);
 if(!url)throw new Error("Trimble liefert keine signierte Download-URL.");
 let u;try{u=new URL(url)}catch(_){throw new Error("Ungültige Download-URL.")}
 if(u.protocol!=="https:")throw new Error("Unsichere Download-URL verworfen.");
 if(u.username||u.password)throw new Error("Download-URL enthält unerwartete Zugangsdaten.");
 // This URL is supplied by the authenticated Trimble API; bearer token is NOT forwarded to it.
 return u.toString();
}
function isStepIfc(bytes){
 if(bytes.byteLength<64)return false;
 const decoder=new TextDecoder("utf-8",{fatal:false});
 const start=decoder.decode(bytes.slice(0,256)).replace(/^\uFEFF/,"").trimStart();
 const tail=decoder.decode(bytes.slice(-Math.min(256,bytes.length)));
 return start.startsWith("ISO-10303-21;")&&tail.includes("END-ISO-10303-21;");
}
export async function downloadOriginalIfc({accessToken,projectId,projectLocation,sourceFileId,preferredVersionId,onProgress=()=>{}}){
 const token=str(accessToken),fileId=str(sourceFileId);
 if(!token)throw new Error("Trimble-Zugriffstoken fehlt.");
 if(!fileId)throw new Error("ID der Quelldatei fehlt.");
 const preferred=str(preferredVersionId);
 const pid=str(projectId);
 const failures=[];
 for(const base of roots(projectLocation)){
  try{
   onProgress("Suche Original-IFC in Trimble-Dateiverwaltung …");
   const meta=unpack(await jsonGet(base,"/files/"+encodeURIComponent(fileId),token));
   const fileName=pick(meta.name,meta.title);
   const actualId=pick(meta.id,meta.fileId);
   const project=pick(meta.projectId,obj(meta.project).id);
   if(actualId&&actualId!==fileId)throw new Error("Datei-ID unterscheidet sich vom ausgewählten Modell.");
   if(pid&&project&&project!==pid)throw new Error("Quelldatei gehört zu einem anderen Projekt.");
   const versionId=pick(preferred,meta.versionId,meta.latestVersionId,meta.fileVersionId);
   if(!versionId)throw new Error("Keine Dateiversion für IFC-Originaldownload gefunden.");
   onProgress("Lade Original-IFC über signierte Trimble-Download-URL …");
   const signed=unpack(await jsonGet(base,
    "/files/fs/"+encodeURIComponent(fileId)+"/downloadurl?versionId="+encodeURIComponent(versionId),token));
   const url=trustedSignedUrl(pick(signed.url,signed.downloadUrl,signed.downloadURL,signed.fileUrl,signed.uploadURL));
   let result;
   try{
    result=await fetch(url,{credentials:"omit",cache:"no-store"});
   }catch(e){throw new Error("Signierter Download nicht erreichbar (CORS/Netzwerk): "+e.message)}
   if(!result.ok)throw new Error("Dateiabruf HTTP "+result.status);
   const bytes=new Uint8Array(await result.arrayBuffer());
   if(bytes.byteLength>400*1024*1024)throw new Error("IFC größer als 400 MB; Browserimport zunächst gesperrt.");
   if(!isStepIfc(bytes)){
    const sig=[...bytes.slice(0,12)].map(b=>b.toString(16).padStart(2,"0")).join(" ");
    throw new Error("Dateispeicher liefert keine STEP-IFC (Signatur "+sig+").");
   }
   return{bytes,name:fileName||"Originalmodell.ifc",fileId,versionId,base,size:bytes.byteLength};
  }catch(e){
   failures.push(base.split("/tc/")[0]+": "+e.message);
  }
 }
 throw new Error("Original-IFC konnte nicht aus Trimble geladen werden: "+failures.join(" | ").slice(0,900));
}
