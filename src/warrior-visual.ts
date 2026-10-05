import { Box3,BufferGeometry,Float32BufferAttribute,Group,Mesh,MeshStandardMaterial,SphereGeometry,ConeGeometry,Vector3 } from 'three';
export interface WarriorVisual {root:Group;wings:[Group,Group]}
/** Original nonrealistic winged combatant, 4 m tall and 8 m across. */
export class WarriorVisualFactory{
  private body=new SphereGeometry(1,10,8);private robe=new ConeGeometry(1.0,2.4,8);
  private feather:BufferGeometry;
  private pearl=new MeshStandardMaterial({color:0xe6e5d9,roughness:.85});
  private cloth=new MeshStandardMaterial({color:0xa85c47,roughness:.9});
  private accent=new MeshStandardMaterial({color:0xe8b573,roughness:.5,metalness:.15});
  constructor(){this.feather=new BufferGeometry();this.feather.setAttribute('position',new Float32BufferAttribute([
    0,0,-.18,2.7,.3,0,0,.1,.18,0,0,-.18,0,-.1,.18,2.7,.3,0,0,.1,.18,2.7,.3,0,0,-.1,.18,0,0,-.18,0,.1,.18,0,-.1,.18],3));this.feather.computeVertexNormals();}
  create():WarriorVisual{const root=new Group();
    const torso=new Mesh(this.body,this.cloth);torso.scale.set(.7,1.05,.5);torso.position.y=.15;root.add(torso);
    const head=new Mesh(this.body,this.accent);head.scale.setScalar(.45);head.position.y=1.55;root.add(head);
    const robe=new Mesh(this.robe,this.pearl);robe.position.y=-.8;root.add(robe);
    const wings:[Group,Group]=[new Group(),new Group()];
    for(let i=0;i<2;i++){const side=i===0?-1:1,wing=wings[i];wing.position.set(side*.65,.6,.2);
      for(let f=0;f<4;f++){const feather=new Mesh(this.feather,this.pearl);feather.position.set(side*f*.17,-f*.2,f*.15);
        feather.scale.x=side*(1+(3-f)*.05);feather.rotation.z=side*(.28-f*.18);wing.add(feather);}root.add(wing);}
    root.updateMatrixWorld(true);const size=new Box3().setFromObject(root).getSize(new Vector3());root.scale.x=8/size.x;
    return{root,wings};}
  dispose(){this.body.dispose();this.robe.dispose();this.feather.dispose();this.pearl.dispose();this.cloth.dispose();this.accent.dispose();}
}
