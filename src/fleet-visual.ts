import { BoxGeometry,BufferGeometry,CylinderGeometry,Float32BufferAttribute,Group,Mesh,MeshStandardMaterial } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAPITAL_SHIP,NAVAL_HULL_BOTTOM,NAVAL_HULL_BOTTOM_INSET,NAVAL_HULL_SECTIONS,NAVAL_STRUCTURE_PARTS } from './fleet-geometry';
/** The fixed source's hull stations/deckhouse solids, one shared friendly fleet template. */
export class FleetVisualFactory{
  private geometries:BufferGeometry[]=[];
  private hullMaterial=new MeshStandardMaterial({color:0x34464f,roughness:.72,metalness:.18});
  private deckMaterial=new MeshStandardMaterial({color:0x9b8762,roughness:.90,metalness:.02});
  private structureMaterial=new MeshStandardMaterial({color:0x5b686d,roughness:.76,metalness:.12});
  private markingMaterial=new MeshStandardMaterial({color:0x27aaa4,roughness:.7});
  private template:Group|null=null;
  create():Group{
    if(this.template)return this.template.clone();const g=new Group();
    const positions:number[]=[],indices:number[]=[];
    for(const [z,width]of NAVAL_HULL_SECTIONS){const beam=width*CAPITAL_SHIP.width;
      positions.push(-beam,CAPITAL_SHIP.deckHeight,z*CAPITAL_SHIP.length,beam,CAPITAL_SHIP.deckHeight,z*CAPITAL_SHIP.length,
        -Math.max(0,beam-NAVAL_HULL_BOTTOM_INSET),NAVAL_HULL_BOTTOM,z*CAPITAL_SHIP.length,
        Math.max(0,beam-NAVAL_HULL_BOTTOM_INSET),NAVAL_HULL_BOTTOM,z*CAPITAL_SHIP.length);}
    for(let i=0;i<NAVAL_HULL_SECTIONS.length-1;i++){const a=i*4,b=a+4;
      indices.push(a,b,a+1,a+1,b,b+1,a+2,a+3,b+2,a+3,b+3,b+2,a,a+2,b,a+2,b+2,b,a+1,b+1,a+3,a+3,b+1,b+3);}
    const last=(NAVAL_HULL_SECTIONS.length-1)*4;indices.push(0,1,2,1,3,2,last,last+2,last+1,last+1,last+2,last+3);
    const hull=new BufferGeometry();hull.setAttribute('position',new Float32BufferAttribute(positions,3));hull.setIndex(indices);hull.computeVertexNormals();this.geometries.push(hull);
    g.add(new Mesh(hull,this.hullMaterial));
    const parts:BufferGeometry[]=[];
    for(const p of NAVAL_STRUCTURE_PARTS){const [sx,sy,sz]=p.size;
      const part=p.shape==='box'?new BoxGeometry(sx,sy,sz):new CylinderGeometry(1,1,sy,12);
      if(p.shape==='cylinder')part.scale(sx,1,sz);part.translate(...p.position);parts.push(part);}
    // Static main-gun silhouette; the new game has one logical AA battery per ship.
    for(const [z,y]of [[-75,12.5],[-49,16.5],[80,12.5]]){
      const turret=new BoxGeometry(12.5,5.3,14.5);turret.translate(0,y-1,z);parts.push(turret);
      for(const x of [-2.6,0,2.6]){const barrel=new CylinderGeometry(.35,.35,18,8);barrel.rotateX(Math.PI/2);barrel.translate(x,y,z+(z>0?9:-9));parts.push(barrel);}}
    const structure=mergeGeometries(parts);for(const p of parts)p.dispose();if(structure){this.geometries.push(structure);g.add(new Mesh(structure,this.structureMaterial));}
    const bridge=new BoxGeometry(16,.35,18);bridge.translate(0,25.2,-25);this.geometries.push(bridge);g.add(new Mesh(bridge,this.markingMaterial));
    const deck=new BufferGeometry();const d:number[]=[];
    for(let i=0;i<NAVAL_HULL_SECTIONS.length-1;i++){const [a,aw]=NAVAL_HULL_SECTIONS[i],[b,bw]=NAVAL_HULL_SECTIONS[i+1];
      const wa=aw*CAPITAL_SHIP.width,wb=bw*CAPITAL_SHIP.width,y=CAPITAL_SHIP.deckHeight+.015;
      d.push(-wa,y,a*CAPITAL_SHIP.length,-wb,y,b*CAPITAL_SHIP.length,wa,y,a*CAPITAL_SHIP.length,
        wa,y,a*CAPITAL_SHIP.length,-wb,y,b*CAPITAL_SHIP.length,wb,y,b*CAPITAL_SHIP.length);}
    deck.setAttribute('position',new Float32BufferAttribute(d,3));deck.computeVertexNormals();this.geometries.push(deck);g.add(new Mesh(deck,this.deckMaterial));
    this.template=g;return g.clone();
  }
  dispose(){for(const geometry of this.geometries)geometry.dispose();this.geometries=[];
    for(const material of [this.hullMaterial,this.deckMaterial,this.structureMaterial,this.markingMaterial])material.dispose();this.template=null;}
}
