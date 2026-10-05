/** Fixed Kaisen line widths/tail, adapted to the new authoritative round records. */
import { Group, type InterleavedBufferAttribute } from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { Projectile } from './projectiles';
export const AIR_TRACER_CORE_PX=1.5,AIR_TRACER_OUTLINE_PX=2.5,AIR_TRACER_TAIL_SECONDS=.045;
export class AircraftTracers {
  readonly root=new Group();readonly geometry=new LineSegmentsGeometry();
  readonly positions:Float32Array;readonly colors:Float32Array;
  readonly outlineMaterial=new LineMaterial({color:0x281b10,linewidth:AIR_TRACER_OUTLINE_PX,transparent:true,opacity:.65,depthTest:true,depthWrite:false,toneMapped:false,fog:false});
  readonly coreMaterial=new LineMaterial({vertexColors:true,linewidth:AIR_TRACER_CORE_PX,transparent:true,opacity:1,depthTest:true,depthWrite:false,toneMapped:false,fog:false});
  readonly outline:LineSegments2;readonly core:LineSegments2;private disposed=false;
  constructor(readonly capacity=2048){
    this.positions=new Float32Array(capacity*6);this.colors=new Float32Array(capacity*6);
    this.geometry.setPositions(this.positions).setColors(this.colors);this.geometry.instanceCount=0;
    this.outline=new LineSegments2(this.geometry,this.outlineMaterial);this.core=new LineSegments2(this.geometry,this.coreMaterial);
    this.outline.frustumCulled=this.core.frustumCulled=false;this.outline.renderOrder=1;this.core.renderOrder=2;this.root.add(this.outline,this.core);
  }
  update(projectiles:readonly Projectile[]){let count=0;
    for(const b of projectiles){if(b.kind!=='mg'&&b.kind!=='cannon')continue;if(count>=this.capacity)break;
      const tail=Math.min(AIR_TRACER_TAIL_SECONDS,b.elapsedSeconds),offset=count++*6;
      this.positions.set([b.position.x-b.velocity.x*tail,b.position.y-b.velocity.y*tail,b.position.z-b.velocity.z*tail,b.position.x,b.position.y,b.position.z],offset);
      this.colors.set([1,.7,.14,1,.7,.14],offset);}
    this.geometry.instanceCount=count;
    (this.geometry.attributes.instanceStart as InterleavedBufferAttribute).data.needsUpdate=true;
    (this.geometry.attributes.instanceColorStart as InterleavedBufferAttribute).data.needsUpdate=true;
  }
  resize(width:number,height:number){this.coreMaterial.resolution.set(width,height);this.outlineMaterial.resolution.set(width,height);}
  diagnostics(){return{segments:this.geometry.instanceCount,capacity:this.capacity,corePx:AIR_TRACER_CORE_PX,outlinePx:AIR_TRACER_OUTLINE_PX,tailSeconds:AIR_TRACER_TAIL_SECONDS};}
  dispose(){if(this.disposed)return;this.disposed=true;this.geometry.dispose();this.coreMaterial.dispose();this.outlineMaterial.dispose();}
}
