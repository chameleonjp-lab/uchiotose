/** P7 presentation: all pools are fixed; no logic state is modified by drawing. */
import { ACESFilmicToneMapping,BackSide,BufferGeometry,Color,ConeGeometry,DirectionalLight,Float32BufferAttribute,Fog,
  Group,HemisphereLight,InstancedBufferAttribute,InstancedMesh,LineBasicMaterial,LineSegments,Matrix3,Matrix4,Mesh,MeshBasicMaterial,MeshStandardMaterial,
  OctahedronGeometry,PerspectiveCamera,Quaternion,Scene,ShaderMaterial,SphereGeometry,SRGBColorSpace,TorusGeometry,Vector3,
  type Material } from 'three';
import { AircraftFactory,type AircraftVisual } from './aircraft';
import { AircraftBatchFactory } from './aircraft-batch';
import { AircraftTracers } from './aircraft-tracers';
import { FleetVisualFactory } from './fleet-visual';
import { WarriorVisualFactory,type WarriorVisual } from './warrior-visual';
import { WebGLRenderer } from 'three';
import { RenderQueue } from './render-queue';
import { createOceanGeometry,oceanAnchor } from './ocean';
import { seaVertex,seaFragment,skyVertex,skyFragment } from './atmosphere';
import { ISLAND_TRIANGLES,ISLAND_VERTICES,lineOfSight } from './island';
import { FLIGHT_FOV,getFlightCameraPose } from './flight-view';
import { drawHUDOverlay } from './hud-overlay';
import { add,distance,lerp,vec,clamp } from './world-math';
import type { WorldState,GameMode,Vec3,AircraftPose } from './world';
import type { MissionState } from './roster';
import type { Projectile } from './projectiles';

export type RenderQuality='low'|'medium'|'high';
interface Burst {position:Vec3;since:number;active:boolean}
interface WarriorBatch {mesh:InstancedMesh;normals:InstancedBufferAttribute;sources:{root:Group;mesh:Mesh;reflected:boolean}[]}
const BURST_CAPACITY=24;
const p3=(v:Vec3)=>new Vector3(v.x,v.y,v.z);
/** Source camera/light/ocean and source aircraft; original island and winged warriors. */
export class WorldRenderer{
  readonly renderer:WebGLRenderer;
  readonly camera=new PerspectiveCamera(FLIGHT_FOV,1,.5,22000);
  private scene=new Scene();private queue:RenderQueue;
  private aircraft=new AircraftFactory();private batches=new AircraftBatchFactory();private aircraftTracers=new AircraftTracers();
  private planes:AircraftVisual[]=[];private warriors=new WarriorVisualFactory();private enemies:WarriorVisual[]=[];
  private warriorBatches:WarriorBatch[]=[];private reflection=new Matrix4().makeScale(-1,1,1);
  private instanceNormal=new Matrix3();
  private fleetFactory=new FleetVisualFactory();private fleet:Group[]=[];
  private ownedGeometries:BufferGeometry[]=[];private ownedMaterials:Material[]=[];
  private seaMaterial=new ShaderMaterial({uniforms:{uTime:{value:0}},vertexShader:seaVertex,fragmentShader:seaFragment});
  private sea=new Mesh(createOceanGeometry(),this.seaMaterial);
  private sky=new Mesh(new SphereGeometry(21000,32,20),new ShaderMaterial({vertexShader:skyVertex,fragmentShader:skyFragment,side:BackSide,depthWrite:false}));
  private fire:InstancedMesh;private ice:InstancedMesh;private burns:InstancedMesh;private frost:InstancedMesh;private bursts:InstancedMesh;
  private lines:LineSegments;private linePositions=new Float32Array(320*6);private lineColors=new Float32Array(320*6);
  private burstPool:Burst[]=Array.from({length:BURST_CAPACITY},()=>({position:vec(),since:0,active:false}));
  private previousBodies=new Map<string,Vec3>();private missionId:string|null=null;private resetVersion=-1;
  private lastPlayer:AircraftPose|null=null;private lastCameraPlayerId:string|null=null;
  private matrix=new Matrix4();private orientation=new Quaternion();private position=new Vector3();private scale=new Vector3();
  private width=1;private height=1;private disposed=false;private quality:RenderQuality='medium';
  private readonly rendererBackend:string;private readonly softwareRenderer:boolean;
  private initialWarmPendingMs:number|null=null;
  private viewRevision=0;private lastStaticFrameKey:string|null=null;
  private lastSubmittedFrame:{missionId:string;phase:MissionState['phase'];tick:number;mode:GameMode;calls:number;triangles:number}|null=null;
  private overlay:CanvasRenderingContext2D|null;

  constructor(private canvas:HTMLCanvasElement,private overlayCanvas?:HTMLCanvasElement){
    this.renderer=new WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
    const gl=this.renderer.getContext();if(!('fenceSync'in gl))throw new Error('WebGL2 is required');this.queue=new RenderQueue(gl);
    const rendererInfo=gl.getExtension('WEBGL_debug_renderer_info');
    this.rendererBackend=String(gl.getParameter(rendererInfo?.UNMASKED_RENDERER_WEBGL??gl.RENDERER));
    this.softwareRenderer=/swiftshader|llvmpipe|softpipe|software rasterizer/i.test(this.rendererBackend);
    this.renderer.setPixelRatio(this.renderPixelRatio());this.renderer.outputColorSpace=SRGBColorSpace;
    this.renderer.toneMapping=ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.1;
    this.overlay=overlayCanvas?.getContext('2d')??null;
    this.scene.background=new Color(0xaecbd0);this.scene.fog=new Fog(0xaecbd0,1400,6000);
    this.scene.add(new HemisphereLight(0xc6e5ec,0x23424e,2.3));const sun=new DirectionalLight(0xffe9b5,3.1);sun.position.set(-600,700,-350);this.scene.add(sun);
    this.scene.add(this.sea,this.sky,this.aircraftTracers.root);this.createIsland();
    for(let i=0;i<8;i++){const detail=i===0?'hero':'enemy',v=this.batches.optimize(this.aircraft.create(detail),detail);v.root.visible=false;this.planes.push(v);this.scene.add(v.root);}
    for(let i=0;i<24;i++){const v=this.warriors.create();v.root.visible=false;this.enemies.push(v);}this.createWarriorBatches();
    for(let i=0;i<10;i++){const v=this.fleetFactory.create();v.visible=false;this.fleet.push(v);this.scene.add(v);}
    this.fire=this.instance(new SphereGeometry(1.5,8,6),new MeshBasicMaterial({color:0xff913a}),256);
    this.ice=this.instance(new OctahedronGeometry(1.5),new MeshBasicMaterial({color:0xa3ecff}),256);
    this.burns=this.instance(new ConeGeometry(1,3,6),new MeshBasicMaterial({color:0xff9a3a,transparent:true,opacity:.8,depthWrite:false}),44);
    this.frost=this.instance(new TorusGeometry(1,.08,4,12),new MeshBasicMaterial({color:0xb3efff,transparent:true,opacity:.9,depthWrite:false}),18);
    this.bursts=this.instance(new OctahedronGeometry(1),new MeshBasicMaterial({color:0xffd685,wireframe:true}),BURST_CAPACITY);
    const lineGeometry=new BufferGeometry();lineGeometry.setAttribute('position',new Float32BufferAttribute(this.linePositions,3));
    lineGeometry.setAttribute('color',new Float32BufferAttribute(this.lineColors,3));lineGeometry.setDrawRange(0,0);this.ownedGeometries.push(lineGeometry);
    const lineMaterial=new LineBasicMaterial({vertexColors:true,transparent:true,opacity:.9});this.ownedMaterials.push(lineMaterial);
    this.lines=new LineSegments(lineGeometry,lineMaterial);this.lines.frustumCulled=false;this.scene.add(this.lines);this.resize();
  }
  private instance(geometry:BufferGeometry,material:Material,capacity:number):InstancedMesh{
    this.ownedGeometries.push(geometry);this.ownedMaterials.push(material);const mesh=new InstancedMesh(geometry,material,capacity);
    mesh.count=0;mesh.frustumCulled=false;this.scene.add(mesh);return mesh;
  }
  private createWarriorBatches(){
    const groups=new Map<string,{geometry:BufferGeometry;material:Material;sources:WarriorBatch['sources']}>();
    const materials=new Map<Material,Material>();
    for(const visual of this.enemies){visual.root.updateMatrixWorld(true);visual.root.traverse(object=>{
      if(!(object instanceof Mesh)||Array.isArray(object.material))return;
      const reflected=object.matrixWorld.determinant()<0,key=`${object.geometry.uuid}:${object.material.uuid}:${reflected}`;
      let group=groups.get(key);
      if(!group){const geometry=object.geometry.clone();this.ownedGeometries.push(geometry);
        if(reflected){
          // InstancedMesh cannot flip front-face winding per instance. Bake the
          // left-wing reflection into shared vertices/normals, then reverse faces.
          geometry.applyMatrix4(this.reflection);
          const indices=geometry.index?Array.from(geometry.index.array):Array.from({length:geometry.attributes.position.count},(_,i)=>i);
          for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
          geometry.setIndex(indices);
        }
        const originalMaterial:Material=object.material;
        let material=materials.get(originalMaterial);
        if(!material){const created=originalMaterial.clone();
          // Wing animation beneath the neutral span scale creates slight shear.
          // Use the true inverse-transpose, as ordinary source Mesh draws do.
          created.onBeforeCompile=shader=>{
            shader.vertexShader=`attribute mat3 instanceNormalMatrix;\n${shader.vertexShader}`;
            shader.vertexShader=shader.vertexShader.replace('#include <defaultnormal_vertex>',`#include <defaultnormal_vertex>
              transformedNormal=normalMatrix*instanceNormalMatrix*objectNormal;
              #ifdef FLIP_SIDED
                transformedNormal=-transformedNormal;
              #endif`);
          };
          created.customProgramCacheKey=()=> 'warrior-exact-instance-normal-v1';
          this.ownedMaterials.push(created);materials.set(originalMaterial,created);material=created;
        }
        group={geometry,material,sources:[]};groups.set(key,group);
      }
      group.sources.push({root:visual.root,mesh:object,reflected});
    });}
    for(const group of groups.values()){
      const mesh=new InstancedMesh(group.geometry,group.material,group.sources.length);mesh.count=0;mesh.frustumCulled=false;
      const normals=new InstancedBufferAttribute(new Float32Array(group.sources.length*9),9);
      this.instanceNormal.identity();for(let i=0;i<group.sources.length;i++)normals.array.set(this.instanceNormal.elements,i*9);
      group.geometry.setAttribute('instanceNormalMatrix',normals);
      this.warriorBatches.push({mesh,normals,sources:group.sources});this.scene.add(mesh);
    }
  }
  private updateWarriorBatches(){
    for(const batch of this.warriorBatches){let count=0;
      for(const source of batch.sources){if(!source.root.visible)continue;
        this.matrix.copy(source.mesh.matrixWorld);if(source.reflected)this.matrix.multiply(this.reflection);
        batch.mesh.setMatrixAt(count,this.matrix);this.instanceNormal.getNormalMatrix(this.matrix);
        batch.normals.array.set(this.instanceNormal.elements,count*9);count++;
      }
      batch.mesh.count=count;batch.mesh.instanceMatrix.needsUpdate=true;batch.normals.needsUpdate=true;
    }
  }
  private createIsland(){
    const geometry=new BufferGeometry(),positions:number[]=[],colors:number[]=[];
    for(let i=0;i<ISLAND_TRIANGLES.length;i+=3){const tri=ISLAND_TRIANGLES.slice(i,i+3).map(index=>ISLAND_VERTICES[index]);
      const top=tri.every(p=>p.y===800),shade=.78+(i%11)/60;
      for(const p of tri){positions.push(p.x,p.y,p.z);colors.push(...(top?[.16*shade,.29*shade,.17*shade]:[.34*shade,.33*shade,.28*shade]));}}
    geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.setAttribute('color',new Float32BufferAttribute(colors,3));geometry.computeVertexNormals();
    const material=new MeshStandardMaterial({vertexColors:true,roughness:1});this.ownedGeometries.push(geometry);this.ownedMaterials.push(material);
    const island=new Mesh(geometry,material);island.name='original-floating-island';this.scene.add(island);
  }
  resize(width?:number,height?:number){
    const rect=this.canvas.getBoundingClientRect();const w=width??rect.width,h=height??rect.height;if(w<=0||h<=0||this.disposed)return;
    this.width=w;this.height=h;this.viewRevision++;this.lastStaticFrameKey=null;
    this.renderer.setSize(w,h,false);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.aircraftTracers.resize(w,h);
    if(this.overlayCanvas){this.overlayCanvas.width=Math.round(w);this.overlayCanvas.height=Math.round(h);}
  }
  resetCamera(){this.lastPlayer=null;this.lastCameraPlayerId=null;this.resetVersion=-1;this.viewRevision++;this.lastStaticFrameKey=null;}
  private renderPixelRatio():number{
    const limit=this.quality==='low'?1:this.quality==='medium'?1.5:2;
    // R20 permits resolution quality steps. CPU rasterizers need fewer shaded
    // pixels; hardware keeps the fixed source's caps and all world rules agree.
    return Math.min(window.devicePixelRatio||1,limit)*(this.softwareRenderer ? .75 : 1);
  }
  setQuality(quality:RenderQuality){if(this.quality===quality)return;this.quality=quality;
    this.renderer.setPixelRatio(this.renderPixelRatio());this.resize();}
  /** Warm each shared geometry/material before the first full-size authoritative view. */
  async prepare():Promise<void>{
    if(this.disposed)return;
    const roots=[this.planes[0].root,this.planes[1].root,this.fleet[0]];
    const saved=roots.map(root=>({root,visible:root.visible,position:root.position.clone(),scale:root.scale.clone()}));
    const instances=[this.fire,this.ice,this.burns,this.frost,this.bursts,...this.warriorBatches.map(batch=>batch.mesh)],ratio=this.renderer.getPixelRatio();
    const warmPoint=(x:number,y:number,z:number)=>new Vector3(x,y,z).applyQuaternion(this.camera.quaternion).add(this.camera.position);
    try{
      for(let i=0;i<roots.length;i++){roots[i].visible=true;roots[i].position.copy(warmPoint(i*8-12,0,-80));if(i===2)roots[i].scale.setScalar(.03);}
      const warm=warmPoint(0,2,-70);
      for(const mesh of instances){mesh.count=1;this.matrixAt(mesh,0,warm);mesh.instanceMatrix.needsUpdate=true;}
      this.instanceNormal.identity();for(const batch of this.warriorBatches){batch.normals.array.set(this.instanceNormal.elements,0);batch.normals.needsUpdate=true;}
      const start=warmPoint(-1,0,-70),end=warmPoint(1,0,-70),segment=[start.x,start.y,start.z,end.x,end.y,end.z];
      this.aircraftTracers.positions.set(segment);this.aircraftTracers.colors.set([1,.7,.14,1,.7,.14]);
      this.aircraftTracers.geometry.instanceCount=1;
      (this.aircraftTracers.geometry.attributes.instanceStart as import('three').InterleavedBufferAttribute).data.needsUpdate=true;
      (this.aircraftTracers.geometry.attributes.instanceColorStart as import('three').InterleavedBufferAttribute).data.needsUpdate=true;
      this.linePositions.set(segment);
      this.lineColors.set([1, .8, .3, 1, .8, .3]);
      this.lines.geometry.setDrawRange(0, 2);
      this.lines.geometry.attributes.position.needsUpdate = true;
      this.lines.geometry.attributes.color.needsUpdate = true;
      await this.renderer.compileAsync(this.scene,this.camera);
      if(this.disposed)return;
      // A tiny loading frame initializes backend draws/buffers without shading a large viewport.
      // Full-size Start readiness is separately gated by main's real Home frame fence.
      this.renderer.setPixelRatio(1);this.renderer.setSize(16,16,false);
      this.renderer.render(this.scene,this.camera);const submitted=performance.now();this.queue.submit(submitted);
      await new Promise<void>((resolve,reject)=>{
        const check=()=>{if(this.disposed){resolve();return;}const now=performance.now(),status=this.queue.poll(now);
          // Fixed Kaisen prepare likewise permits initial backend warm-up to finish
          // before flight exists. The in-flight queue's 1 s stall policy is unchanged.
          if(status==='ready'){this.initialWarmPendingMs=now-submitted;resolve();}
          else if(status==='failed'||now-submitted>30000)reject(new Error(`Graphics warm-up ${status}`));
          else requestAnimationFrame(check);};
        requestAnimationFrame(check);
      });
    }finally{
      for(const {root,visible,position,scale}of saved){root.visible=visible;root.position.copy(position);root.scale.copy(scale);}
      for(const mesh of instances)mesh.count=0;this.aircraftTracers.update([]);this.lines.geometry.setDrawRange(0,0);
      if(!this.disposed){this.renderer.setPixelRatio(ratio);this.resize();}
    }
  }
  pollRender(now=performance.now()){return this.queue.poll(now);}
  resetRenderQueue(){this.queue.reset();this.lastStaticFrameKey=null;this.lastSubmittedFrame=null;}
  render(w:WorldState,m:MissionState,projectiles:readonly Projectile[]=[],mode:GameMode='normal',alpha=1,quality?:RenderQuality):boolean{
    if(this.disposed)return false;if(quality)this.setQuality(quality);
    const status=this.queue.poll(performance.now());if(status==='pending')return false;
    if(status==='failed'||status==='stalled'){const last=this.lastSubmittedFrame,pending=this.queue.diagnostics(performance.now()).pendingMs;
      throw new Error(`GPU frame ${status}; last ${last?.missionId??'initial'}/${last?.phase??'loading'} tick ${last?.tick??0}, current ${m.missionId}/${m.phase} tick ${m.tick}, ${Math.round(pending)} ms pending; ${last?.calls??0} calls, ${last?.triangles??0} triangles, ${this.renderer.info.programs?.length??0} programs, DPR ${this.renderer.getPixelRatio()}`);}
    const time=m.tick/60,t=clamp(alpha,0,1);
    if(this.missionId!==m.missionId){this.missionId=m.missionId;this.previousBodies.clear();for(const b of this.burstPool)b.active=false;this.resetCamera();}
    if(this.resetVersion!==m.controlResetVersion){this.resetVersion=m.controlResetVersion;this.lastPlayer=null;}
    const staticFrameKey=`${m.missionId}:${m.phase}:${m.tick}:${m.controlResetVersion}:${mode}:${this.viewRevision}`;
    // Home, Pause and Result have no advancing visual clock. Poll completion above
    // on every rAF, but do not submit identical worlds behind modal compositing.
    if(m.phase!=='playing'&&this.lastStaticFrameKey===staticFrameKey)return false;
    const aircraft=m.aircraft.filter(a=>a.status==='active').sort((a,b)=>Number(b.id===m.controlledAircraftId)-Number(a.id===m.controlledAircraftId)||a.id.localeCompare(b.id));
    for(let i=0;i<this.planes.length;i++){const visual=this.planes[i],a=aircraft[i],p=a&&w.aircraft[a.id];visual.root.visible=Boolean(p);
      if(!p)continue;visual.root.position.copy(p3(lerp(p.previousPosition,p.position,t)));
      visual.root.quaternion.set(p.previousQuaternion.x,p.previousQuaternion.y,p.previousQuaternion.z,p.previousQuaternion.w)
        .slerp(new Quaternion(p.quaternion.x,p.quaternion.y,p.quaternion.z,p.quaternion.w),t);
      visual.propeller.rotation.z=time*(34+Math.min(8,p.speed*.035))%(Math.PI*2);const d=clamp(p.bank*.34,-.3,.3);
      visual.ailerons[0].rotation.x=d;visual.ailerons[1].rotation.x=-d;visual.elevator.rotation.x=clamp(-p.pitch*.32,-.26,.26);}
    const enemies=m.enemies.filter(e=>e.status==='active').sort((a,b)=>a.id.localeCompare(b.id));
    for(let i=0;i<this.enemies.length;i++){const visual=this.enemies[i],e=enemies[i],p=e&&w.enemies[e.id];visual.root.visible=Boolean(p);if(!p)continue;
      visual.root.position.copy(p3(lerp(p.previousPosition,p.position,t)));visual.root.quaternion.set(p.quaternion.x,p.quaternion.y,p.quaternion.z,p.quaternion.w);
      const flap=this.quality==='low'?0:Math.sin(time*5+i*.7)*.22;visual.wings[0].rotation.y=flap;visual.wings[1].rotation.y=-flap;visual.root.updateMatrixWorld(true);}
    this.updateWarriorBatches();
    for(let i=0;i<m.ships.length&&i<10;i++){const s=m.ships[i],visual=this.fleet[i],p=w.ships[s.id];visual.visible=Boolean(p&&s.status==='alive');if(!p)continue;
      visual.position.copy(p3(lerp(p.previousPosition,p.position,t)));visual.quaternion.set(p.quaternion.x,p.quaternion.y,p.quaternion.z,p.quaternion.w);}
    const liveBodies=new Map<string,Vec3>();for(const a of aircraft)if(w.aircraft[a.id])liveBodies.set(a.id,{...w.aircraft[a.id].position});
    for(const e of enemies)if(w.enemies[e.id])liveBodies.set(e.id,{...w.enemies[e.id].position});
    for(const [id,position]of this.previousBodies)if(!liveBodies.has(id)){const free=this.burstPool.find(b=>!b.active||time-b.since>=2);
      if(free){free.position={...position};free.since=time;free.active=true;}}
    this.previousBodies=liveBodies;
    this.updateProjectiles(projectiles,t);this.updateEffects(w,m,time);
    const player=m.controlledAircraftId?w.aircraft[m.controlledAircraftId]:null;
    if(player){const interpolated={...player,position:lerp(player.previousPosition,player.position,t)};
      const q=new Quaternion(player.previousQuaternion.x,player.previousQuaternion.y,player.previousQuaternion.z,player.previousQuaternion.w)
        .slerp(new Quaternion(player.quaternion.x,player.quaternion.y,player.quaternion.z,player.quaternion.w),t);
      interpolated.quaternion={x:q.x,y:q.y,z:q.z,w:q.w};this.lastPlayer=interpolated;this.lastCameraPlayerId=player.id;}
    if(this.lastPlayer){const camera=getFlightCameraPose(this.lastPlayer,mode);this.camera.position.copy(p3(camera.position));
      this.camera.quaternion.set(camera.rotation.x,camera.rotation.y,camera.rotation.z,camera.rotation.w);}
    else{this.camera.position.set(0,1300,4600);this.camera.lookAt(0,700,0);}
    this.camera.updateMatrixWorld();this.sky.position.copy(this.camera.position);this.sea.position.x=oceanAnchor(this.camera.position.x);
    this.sea.position.z=oceanAnchor(this.camera.position.z);this.seaMaterial.uniforms.uTime.value=time;
    this.renderer.render(this.scene,this.camera);this.drawOverlay(w,m,mode);this.queue.submit(performance.now());
    this.lastStaticFrameKey=m.phase==='playing'?null:staticFrameKey;
    this.lastSubmittedFrame={missionId:m.missionId,phase:m.phase,tick:m.tick,mode,calls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles};return true;
  }
  private matrixAt(mesh:InstancedMesh,index:number,p:Vec3,sx=1,sy=sx,sz=sx){
    this.position.set(p.x,p.y,p.z);this.scale.set(sx,sy,sz);this.orientation.identity();this.matrix.compose(this.position,this.orientation,this.scale);mesh.setMatrixAt(index,this.matrix);
  }
  private updateProjectiles(projectiles:readonly Projectile[],alpha:number){let fire=0,ice=0,line=0;
    for(const b of projectiles){const p=lerp(b.previousPosition,b.position,alpha);
      if(b.kind==='fire'&&fire<256)this.matrixAt(this.fire,fire++,p);
      if(b.kind==='ice'&&ice<256)this.matrixAt(this.ice,ice++,p);
      if(b.kind==='anti-air'||b.kind==='fire'||b.kind==='ice'){if(line>=320)continue;const tailSeconds=b.kind==='anti-air'?.025:.06;
        const tail={x:p.x-b.velocity.x*tailSeconds,y:p.y-b.velocity.y*tailSeconds,z:p.z-b.velocity.z*tailSeconds};
        this.linePositions.set([tail.x,tail.y,tail.z,p.x,p.y,p.z],line*6);
        const c=b.kind==='ice'?[.65,.9,1]:b.kind==='fire'?[1,.34,.05]:[1,.83,.42];this.lineColors.set([...c,...c],line*6);line++;}}
    this.fire.count=fire;this.ice.count=ice;this.fire.instanceMatrix.needsUpdate=this.ice.instanceMatrix.needsUpdate=true;
    this.lines.geometry.setDrawRange(0,line*2);this.lines.geometry.attributes.position.needsUpdate=true;this.lines.geometry.attributes.color.needsUpdate=true;
    this.aircraftTracers.update(projectiles);
  }
  private updateEffects(w:WorldState,m:MissionState,time:number){let burns=0,frost=0,bursts=0;
    for(const owner of [...m.aircraft.filter(a=>a.status==='active'),...m.ships.filter(s=>s.status==='alive')]){
      const isShip=owner.id.startsWith('S'),p=isShip?w.ships[owner.id]?.position:w.aircraft[owner.id]?.position;if(!p)continue;
      if(owner.burns.length){for(let f=0;f<2&&burns<44;f++){const phase=time*11+f,flame=add(p,vec(Math.sin(phase)*2,isShip?18:1,f*3));
        const size=isShip?4:1;this.matrixAt(this.burns,burns++,flame,size,size*(.85+.15*Math.sin(phase)),size);}}
      if(owner.ice&&owner.ice.startsAtTick<=m.tick&&m.tick<owner.ice.expiresAtTick&&frost<18){const pIce=add(p,vec(0,isShip?15:0,0));
        this.matrixAt(this.frost,frost++,pIce,isShip?45:8);}}
    for(const b of this.burstPool){const age=time-b.since;if(!b.active||age>=2||age<0){b.active=false;continue;}
      const size=(2+age*12)*(1-age/2);this.matrixAt(this.bursts,bursts++,b.position,size);}
    this.burns.count=burns;this.frost.count=frost;this.bursts.count=bursts;
    this.burns.instanceMatrix.needsUpdate=this.frost.instanceMatrix.needsUpdate=this.bursts.instanceMatrix.needsUpdate=true;
  }
  private drawOverlay(w:WorldState,m:MissionState,mode:GameMode){
    if(this.overlay) drawHUDOverlay(this.overlay,this.width,this.height,w,m,mode,this.lastPlayer,this.camera);
  }
  diagnostics(){return{queue:this.queue.diagnostics(performance.now()),calls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles,
    geometries:this.renderer.info.memory.geometries,textures:this.renderer.info.memory.textures,planes:this.planes.length,warriors:this.enemies.length,ships:this.fleet.length,
    burstCapacity:BURST_CAPACITY,bursts:this.burstPool.filter(b=>b.active).length,warriorDrawBatches:this.warriorBatches.length,quality:this.quality,width:this.width,height:this.height,
    pixelRatio:this.renderer.getPixelRatio(),rendererBackend:this.rendererBackend,softwareRenderer:this.softwareRenderer,
    programs:this.renderer.info.programs?.length??0,initialWarmPendingMs:this.initialWarmPendingMs,lastSubmittedFrame:this.lastSubmittedFrame,aircraftTracers:this.aircraftTracers.diagnostics()};}
  dispose(){if(this.disposed)return;this.disposed=true;this.queue.dispose();this.aircraftTracers.dispose();
    for(const plane of this.planes)plane.root.removeFromParent();this.planes=[];this.batches.dispose();this.aircraft.dispose();
    for(const batch of this.warriorBatches){batch.mesh.removeFromParent();batch.mesh.dispose();}this.warriorBatches=[];
    for(const enemy of this.enemies)enemy.root.removeFromParent();this.enemies=[];this.warriors.dispose();
    for(const ship of this.fleet)ship.removeFromParent();this.fleet=[];this.fleetFactory.dispose();
    for(const mesh of [this.fire,this.ice,this.burns,this.frost,this.bursts])mesh.dispose();
    for(const geometry of this.ownedGeometries)geometry.dispose();for(const material of this.ownedMaterials)material.dispose();
    this.sea.geometry.dispose();this.seaMaterial.dispose();this.sky.geometry.dispose();this.sky.material.dispose();
    this.previousBodies.clear();this.scene.clear();this.renderer.dispose();}
}
