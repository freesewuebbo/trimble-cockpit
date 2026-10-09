// LEANNOVA V2: standalone IFC2X3 supplements from newly drawn blocks and library objects.
// Each object remains independent and can be reimported as a building-element proxy.
// Coordinates are metres in IFC global XY/Z; no source IFC is modified.
const A="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
function guid(){
 const buf=new Uint8Array(16);crypto.getRandomValues(buf);
 const n=[buf[0],buf[1]*65536+buf[2]*256+buf[3],buf[4]*65536+buf[5]*256+buf[6],buf[7]*65536+buf[8]*256+buf[9],buf[10]*65536+buf[11]*256+buf[12],buf[13]*65536+buf[14]*256+buf[15]];
 return n.map((v,i)=>{let s="";for(let j=0;j<(i===0?2:4);j++){s=A[v%64]+s;v=Math.floor(v/64)}return s}).join("");
}
function fmt(v){if(!Number.isFinite(v))throw Error("IFC: Ungültige Koordinate");let s=Number(v.toFixed(7)).toString();if(!s.includes("."))s+=".";return s}
function quote(s){return "'"+String(s||"").replace(/'/g,"''")+"'";}
function line(header,body){return"#"+header+"="+body+";";}
export function createSupplementIfc(THREE,objects){
 const lines=[];let next=1;
 function add(type,args){let id=next++;lines.push(line(id,type+"("+args.join(",")+")"));return id}
 const ref=id=>"#"+id;
 const pt=(x,y,z)=>add("IFCCARTESIANPOINT",["("+[x,y,z].map(fmt).join(",")+")"]);
 const d=(x,y,z)=>add("IFCDIRECTION",["("+[x,y,z].map(fmt).join(",")+")"]);
 const vector=v=>"("+[v.x,v.y,v.z].map(fmt).join(",")+")";
 const person=add("IFCPERSON",["$","$","'LEANNOVA'","$","$","$","$","$"]);
 const org=add("IFCORGANIZATION",["$","'LEANNOVA'","$","$","$"]);
 const pa=add("IFCPERSONANDORGANIZATION",[ref(person),ref(org),"$"]);
 const app=add("IFCAPPLICATION",[ref(org),"'V2'","'LEANNOVA Layout Planner'","'LP-V2'"]);
 const owner=add("IFCOWNERHISTORY",[ref(pa),ref(app),"$",".ADDED.","$","$","$",String(Math.floor(Date.now()/1000))]);
 const origin=pt(0,0,0),z=d(0,0,1),x=d(1,0,0);
 const axis=add("IFCAXIS2PLACEMENT3D",[ref(origin),ref(z),ref(x)]);
 const context=add("IFCGEOMETRICREPRESENTATIONCONTEXT",["$","'Model'","3","1.E-05",ref(axis),"$"]);
 const length=add("IFCSIUNIT",["*",".LENGTHUNIT.","$",".METRE."]);
 const area=add("IFCSIUNIT",["*",".AREAUNIT.","$",".SQUARE_METRE."]);
 const volume=add("IFCSIUNIT",["*",".VOLUMEUNIT.","$",".CUBIC_METRE."]);
 const angle=add("IFCSIUNIT",["*",".PLANEANGLEUNIT.","$",".RADIAN."]);
 const units=add("IFCUNITASSIGNMENT",["("+[length,area,volume,angle].map(ref).join(",")+")"]);
 const project=add("IFCPROJECT",[quote(guid()),ref(owner),"'Layout-Planner V2 Ergänzungen'","$","$","$","$","("+ref(context)+")",ref(units)]);
 const sitePlace=add("IFCLOCALPLACEMENT",["$",ref(axis)]);
 const site=add("IFCSITE",[quote(guid()),ref(owner),"'Layout Site'","$","$",ref(sitePlace),"$","$",".ELEMENT.","$","$","$","$","$"]);
 const buildingPlace=add("IFCLOCALPLACEMENT",[ref(sitePlace),ref(axis)]);
 const building=add("IFCBUILDING",[quote(guid()),ref(owner),"'Layout Gebäude'","$","$",ref(buildingPlace),"$","$",".ELEMENT.","$","$","$"]);
 const storeyPlace=add("IFCLOCALPLACEMENT",[ref(buildingPlace),ref(axis)]);
 const storey=add("IFCBUILDINGSTOREY",[quote(guid()),ref(owner),"'Layout Ebene'","$","$",ref(storeyPlace),"$","$",".ELEMENT.","0."]);
 add("IFCRELAGGREGATES",[quote(guid()),ref(owner),"$","$",""+ref(project),"("+ref(site)+")"]);
 add("IFCRELAGGREGATES",[quote(guid()),ref(owner),"$","$",ref(site),"("+ref(building)+")"]);
 add("IFCRELAGGREGATES",[quote(guid()),ref(owner),"$","$",ref(building),"("+ref(storey)+")"]);
 const contained=[];
 for(const o of objects){
  o.updateMatrixWorld(true);
  const mesh=o.children.find(x=>x.isMesh);
  if(!mesh||mesh.geometry?.type!=="BoxGeometry")throw Error("Neue IFC-Ergänzung "+o.userData.name+": nur Quader unterstützt.");
  const pos=new THREE.Vector3(),rot=new THREE.Quaternion(),scale=new THREE.Vector3();
  o.matrixWorld.decompose(pos,rot,scale);
  const dims=[mesh.scale.x*scale.x,mesh.scale.y*scale.y,mesh.scale.z*scale.z];
  if(dims.some(n=>!Number.isFinite(n)||n<=.001))throw Error("IFC-Ergänzung hat ungültige Abmessungen: "+o.userData.name);
  const axisX=new THREE.Vector3(1,0,0).applyQuaternion(rot).normalize();
  const axisZ=new THREE.Vector3(0,0,1).applyQuaternion(rot).normalize();
  const globalPosition=pt(pos.x,pos.y,pos.z),refX=d(axisX.x,axisX.y,axisX.z),refZ=d(axisZ.x,axisZ.y,axisZ.z);
  const localAxis=add("IFCAXIS2PLACEMENT3D",[ref(globalPosition),ref(refZ),ref(refX)]);
  const placement=add("IFCLOCALPLACEMENT",["$",ref(localAxis)]);
  const point2D=add("IFCCARTESIANPOINT",["(0.,0.)"]);const planeXY=add("IFCAXIS2PLACEMENT2D",[ref(point2D),"$"]);
  const profile=add("IFCRECTANGLEPROFILEDEF",[".AREA.","$",ref(planeXY),fmt(dims[0]),fmt(dims[1])]);
  const bottom=pt(0,0,-dims[2]/2);
  const extrudeAxis=add("IFCAXIS2PLACEMENT3D",[ref(bottom),"$","$"]);
  const solid=add("IFCEXTRUDEDAREASOLID",[ref(profile),ref(extrudeAxis),ref(z),fmt(dims[2])]);
  const hex=mesh.material?.color?.getHex()??0x9aabb5;
  const cr=((hex>>16)&255)/255,cg=((hex>>8)&255)/255,cb=(hex&255)/255;
  const color=add("IFCCOLOURRGB",["$",fmt(cr),fmt(cg),fmt(cb)]);
  const shade=add("IFCSURFACESTYLESHADING",[ref(color)]);
  const style=add("IFCSURFACESTYLE",["'LP-Farbe'",".BOTH.","("+ref(shade)+")"]);
  const assign=add("IFCPRESENTATIONSTYLEASSIGNMENT",["("+ref(style)+")"]);
  add("IFCSTYLEDITEM",[ref(solid),"("+ref(assign)+")","$"]);
  const rep=add("IFCSHAPEREPRESENTATION",[ref(context),"'Body'","'SweptSolid'","("+ref(solid)+")"]);
  const pshape=add("IFCPRODUCTDEFINITIONSHAPE",["$","$","("+ref(rep)+")"]);
  const elem=add("IFCBUILDINGELEMENTPROXY",[quote(guid()),ref(owner),quote(o.userData.name),"$","$",ref(placement),ref(pshape),"$",".NOTDEFINED."]);
  contained.push(ref(elem));
 }
 if(!contained.length)throw Error("Keine eigenen Objekte zum IFC-Export vorhanden.");
 add("IFCRELCONTAINEDINSPATIALSTRUCTURE",[quote(guid()),ref(owner),"$","$","("+contained.join(",")+")",ref(storey)]);
 const header="ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('ViewDefinition [CoordinationView_V2.0]'),'2;1');\nFILE_NAME('Layout-Ergaenzungen_LP_V002.ifc','"+
 new Date().toISOString().slice(0,19)+"',('LEANNOVA'),('LEANNOVA'),'Layout Planner V2','LEANNOVA','');\nFILE_SCHEMA(('IFC2X3'));\nENDSEC;\nDATA;\n";
 return header+lines.join("\n")+"\nENDSEC;\nEND-ISO-10303-21;\n";
}
