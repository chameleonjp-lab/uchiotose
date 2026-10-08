import { Vector3, type PerspectiveCamera } from 'three';
import { lineOfSight } from './island';
import { projectGunSight } from './gun-sight';
import { add, distance, vec, clamp } from './world-math';
import type { WorldState, GameMode, Vec3, AircraftPose } from './world';
import type { MissionState } from './roster';
const p3 = (v: Vec3) => new Vector3(v.x, v.y, v.z);

/** Product 2D HUD drawing, shared with static UI checks; no WebGL or tick loop. */
export function drawHUDOverlay(c: CanvasRenderingContext2D, width: number, height: number,
  w: WorldState, m: MissionState, mode: GameMode,
  lastPlayer: AircraftPose | null, camera: PerspectiveCamera): void {
    c.clearRect(0, 0, width, height);
    if(m.phase==='home'||m.phase==='loading'||m.phase==='result'||!lastPlayer)return;
    const player=lastPlayer,sight=mode==='normal'?projectGunSight(player,width,height):{x:width/2,y:height/2};
    const radius=mode==='normal'?Math.max(26,Math.min(38,Math.min(width,height)*.085)):Math.min(width,height)*.135;
    let aimColor='#ffffff';const targets=[...m.aircraft.filter(a=>a.status==='active'&&a.id!==m.controlledAircraftId).map(a=>({id:a.id,hp:a.hp,maxHp:80,p:w.aircraft[a.id]?.position,friendly:true,ship:false})),
      ...m.enemies.filter(e=>e.status==='active').map(e=>({id:e.id,hp:e.hp,maxHp:80,p:w.enemies[e.id]?.position,friendly:false,ship:false})),
      ...m.ships.filter(s=>s.status==='alive').map(s=>({id:s.id,hp:s.hp,maxHp:1200,p:add(w.ships[s.id].position,vec(0,20,0)),friendly:true,ship:true}))];
    for(const target of targets){if(!target.p||distance(player.position,target.p)>(target.ship?6000:1500)||!lineOfSight(player.position,target.p))continue;
      const projected=p3(target.p).project(camera);if(projected.z<=-1||projected.z>=1)continue;
      const x=(projected.x*.5+.5)*width,y=(.5-projected.y*.5)*height;
      if(Math.hypot(x-sight.x,y-sight.y)<=radius){if(target.friendly){aimColor='#6cb8ff';break;}aimColor='#ff645b';}}
    c.strokeStyle='rgba(3,25,39,.65)';c.lineWidth=2;drawSight(c,sight.x,sight.y,radius,mode);c.strokeStyle=aimColor;c.lineWidth=1;drawSight(c,sight.x,sight.y,radius,mode);
    c.fillStyle=aimColor;c.fillRect(sight.x-1,sight.y-1,2,2);
    const rosterPlayer=m.aircraft.find(a=>a.id===m.controlledAircraftId);
    if(rosterPlayer?.reloadUntilTick!==null&&rosterPlayer?.reloadUntilTick!==undefined){const progress=1-(rosterPlayer.reloadUntilTick-m.tick)/360;
      c.strokeStyle='#ffd27a';c.lineWidth=3;c.beginPath();c.arc(sight.x,sight.y,radius+7,-Math.PI/2,-Math.PI/2+clamp(progress,0,1)*Math.PI*2);c.stroke();}
    c.shadowColor='rgba(0,20,30,.9)';c.shadowBlur=3;c.font='600 11px system-ui';c.textAlign='center';
    let offscreen:{p:Vec3;d:number}|null=null;
    for(const target of targets){if(!target.p)continue;const d=distance(player.position,target.p);if(d>(target.ship?6000:1500)||!lineOfSight(player.position,target.p))continue;
      const projected=p3(target.p).project(camera),visible=projected.z>-1&&projected.z<1&&Math.abs(projected.x)<.94&&Math.abs(projected.y)<.82;
      if(!visible){if(!target.friendly&&(!offscreen||d<offscreen.d))offscreen={p:target.p,d};continue;}
      const x=(projected.x*.5+.5)*width,y=(.5-projected.y*.5)*height;c.strokeStyle=target.friendly?'#77dacb':'#ffb28b';c.lineWidth=1.25;c.beginPath();
      if(target.ship)c.rect(x-8,y-4,16,8);else if(target.friendly)c.arc(x,y,4,0,Math.PI*2);else{c.moveTo(x,y-6);c.lineTo(x+5,y);c.lineTo(x,y+6);c.lineTo(x-5,y);c.closePath();}c.stroke();
      if(!target.friendly){c.fillStyle='rgba(7,24,32,.8)';c.fillRect(x-19,y+12,38,3);c.fillStyle='#ffc69b';c.fillRect(x-19,y+12,38*target.hp/target.maxHp,3);
        c.fillStyle='#f4e3c8';c.fillText(`${Math.round(d)}m`,x,y+28);}}
    c.shadowBlur=0;
    if(offscreen){const q=p3(offscreen.p).sub(camera.position).applyQuaternion(camera.quaternion.clone().invert());
      const a=Math.atan2(q.y,q.x),cx=width/2,cy=height/2,x=cx+Math.cos(a)*Math.max(30,cx-30),y=cy-Math.sin(a)*Math.max(30,cy-70);
      c.save();c.translate(x,y);c.rotate(-a);c.fillStyle='#ffb28b';c.beginPath();c.moveTo(7,0);c.lineTo(-4,-5);c.lineTo(-4,5);c.closePath();c.fill();c.restore();}
    drawRadar(c,w,m,player,width,height);
  }
function drawSight(c:CanvasRenderingContext2D,x:number,y:number,r:number,mode:GameMode){c.beginPath();c.arc(x,y,r,0,Math.PI*2);
    if(mode==='normal'){c.moveTo(x-r-6,y);c.lineTo(x-r+5,y);c.moveTo(x+r-5,y);c.lineTo(x+r+6,y);c.moveTo(x,y-r-6);c.lineTo(x,y-r+5);c.moveTo(x,y+r-5);c.lineTo(x,y+r+6);}c.stroke();}
function drawRadar(c:CanvasRenderingContext2D,w:WorldState,m:MissionState,player:AircraftPose,width:number,height:number){
    const r=width<360?42:49,x=width-r-18,y=Math.min(height*.33,180);c.save();c.translate(x,y);c.fillStyle='rgba(4,24,34,.66)';c.strokeStyle='rgba(150,212,211,.36)';c.lineWidth=1;
    c.beginPath();c.arc(0,0,r,0,Math.PI*2);c.fill();c.stroke();c.beginPath();c.arc(0,0,r/2,0,Math.PI*2);c.moveTo(-r,0);c.lineTo(r,0);c.moveTo(0,-r);c.lineTo(0,r);c.stroke();
    const cy=Math.cos(player.yaw),sy=Math.sin(player.yaw),range=2400;
    for(const target of [...m.aircraft.filter(a=>a.status==='active'&&a.id!==m.controlledAircraftId),...m.enemies.filter(e=>e.status==='active'),...m.ships.filter(s=>s.status==='alive')]){
      const p=target.id.startsWith('A')?w.aircraft[target.id]?.position:target.id.startsWith('E')?w.enemies[target.id]?.position:w.ships[target.id]?.position;if(!p)continue;
      const dx=p.x-player.position.x,dz=p.z-player.position.z;let px=(dx*cy-dz*sy)/range*r,py=(dx*sy+dz*cy)/range*r;const d=Math.hypot(px,py);
      if(d>r-4){px*=(r-4)/d;py*=(r-4)/d;}const friendly=!target.id.startsWith('E');c.fillStyle=friendly?'#70d8c7':'#ffb78c';c.strokeStyle=c.fillStyle;c.beginPath();
      if(target.id.startsWith('S'))c.rect(px-3,py-1.5,6,3);else if(friendly)c.arc(px,py,2.2,0,7);else{c.moveTo(px,py-3);c.lineTo(px+3,py);c.lineTo(px,py+3);c.lineTo(px-3,py);c.closePath();}
      if(d>r-4)c.stroke();else c.fill();}
    c.fillStyle='#fff4ce';c.beginPath();c.moveTo(0,-5);c.lineTo(3,4);c.lineTo(0,2);c.lineTo(-3,4);c.closePath();c.fill();
    c.fillStyle='#b8cfce';c.font='9px system-ui';c.textAlign='center';c.fillText('2.4km',0,r+13);c.restore();
  }
