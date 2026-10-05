import {WorldRenderer} from '../../src/world-renderer.ts';
import {WarriorVisualFactory} from '../../src/warrior-visual.ts';
import {Box3,Euler,Matrix3,Matrix4,Scene,Vector3} from 'three';
import assert from 'node:assert/strict';
const factory=new WarriorVisualFactory();
const renderer={enemies:Array.from({length:24},()=>factory.create()),scene:new Scene(),warriorBatches:[],ownedGeometries:[],ownedMaterials:[],reflection:new Matrix4().makeScale(-1,1,1),matrix:new Matrix4(),instanceNormal:new Matrix3()};
WorldRenderer.prototype.createWarriorBatches.call(renderer);
assert.equal(renderer.warriorBatches.length,5);
const bounds=new Box3().setFromObject(renderer.enemies[0].root).getSize(new Vector3());assert.ok(Math.abs(bounds.x-8)<1e-8);assert.ok(Math.abs(bounds.y-4)<1e-6);
const matrix=new Matrix4(),normal=new Matrix3();let points=0,maxPositionError=0,maxNormalError=0,minDeterminant=Infinity;
for(const flap of [-.22,0,.22])for(const pose of [[0,0,0],[.45,-1.3,.7],[-.8,2.6,-.6]]){
 for(let i=0;i<renderer.enemies.length;i++){const v=renderer.enemies[i];v.root.visible=true;v.root.position.set(3000+i*3,1000,-4000);v.root.quaternion.setFromEuler(new Euler(...pose,'YXZ'));v.wings[0].rotation.y=flap;v.wings[1].rotation.y=-flap;v.root.updateMatrixWorld(true);}
 WorldRenderer.prototype.updateWarriorBatches.call(renderer);
 for(const batch of renderer.warriorBatches){assert.equal(batch.mesh.count,batch.sources.length);
  for(let i=0;i<batch.sources.length;i++){const source=batch.sources[i].mesh;batch.mesh.getMatrixAt(i,matrix);normal.fromArray(batch.normals.array,i*9);minDeterminant=Math.min(minDeterminant,matrix.determinant());assert.ok(matrix.determinant()>0);
   const sourceNormal=new Matrix3().getNormalMatrix(source.matrixWorld),sp=source.geometry.attributes.position,sn=source.geometry.attributes.normal,bp=batch.mesh.geometry.attributes.position,bn=batch.mesh.geometry.attributes.normal;
   for(let j=0;j<sp.count;j++){const p=new Vector3().fromBufferAttribute(sp,j).applyMatrix4(source.matrixWorld),q=new Vector3().fromBufferAttribute(bp,j).applyMatrix4(matrix),a=new Vector3().fromBufferAttribute(sn,j).applyMatrix3(sourceNormal).normalize(),b=new Vector3().fromBufferAttribute(bn,j).applyMatrix3(normal).normalize();maxPositionError=Math.max(maxPositionError,p.distanceTo(q));maxNormalError=Math.max(maxNormalError,a.distanceTo(b));points++;}
   const si=source.geometry.index,bi=batch.mesh.geometry.index;const face=(geometry,index,offset,transform)=>{const p=[];for(let j=0;j<3;j++)p.push(new Vector3().fromBufferAttribute(geometry.attributes.position,index?index.getX(offset+j):offset+j).applyMatrix4(transform));return p[1].sub(p[0]).cross(p[2].sub(p[0])).normalize();};
   const count=si?.count??sp.count;
   for(let j=0;j<count;j+=3){const a=face(source.geometry,si,j,source.matrixWorld).multiplyScalar(batch.sources[i].reflected?-1:1),b=face(batch.mesh.geometry,bi,j,matrix);assert.ok(a.distanceTo(b)<2e-5);}
  }
 }
}
assert.ok(maxPositionError<.0006);assert.ok(maxNormalError<1e-6);
renderer.enemies[0].root.visible=false;WorldRenderer.prototype.updateWarriorBatches.call(renderer);assert.deepEqual(renderer.warriorBatches.map(b=>b.mesh.count),[23,23,23,92,92]);
for(const e of renderer.enemies)e.root.visible=false;WorldRenderer.prototype.updateWarriorBatches.call(renderer);assert.ok(renderer.warriorBatches.every(b=>b.mesh.count===0));
console.log(JSON.stringify({batches:5,points,maxPositionError,maxNormalError,minDeterminant,neutralBounds:{x:bounds.x,y:bounds.y,z:bounds.z},hiddenCounts:[23,23,23,92,92]},null,2));
for(const b of renderer.warriorBatches)b.mesh.dispose();for(const g of renderer.ownedGeometries)g.dispose();for(const m of renderer.ownedMaterials)m.dispose();factory.dispose();
