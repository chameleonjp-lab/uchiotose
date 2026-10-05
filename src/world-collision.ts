import { CAPITAL_SHIP, NAVAL_HULL_BOTTOM, NAVAL_HULL_BOTTOM_INSET, NAVAL_HULL_SECTIONS, NAVAL_STRUCTURE_PARTS } from './fleet-geometry';
import { dot, sub, length, inverseQuaternion, transformDirection, normalize, add, scale } from './world-math';
import type { Vec3, Quat } from './world-math';
export function segmentSphereHit(from: Vec3, to: Vec3, center: Vec3, radius: number): number | null {
  const p = sub(from, center), d = sub(to, from), c = dot(p, p) - radius * radius;
  if (c <= 0) return 0;
  const a = dot(d, d);
  if (a < 1e-20) return null;
  const b = 2 * dot(p, d), discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}
export function segmentBoxHit(from: Vec3, to: Vec3, min: Vec3, max: Vec3): number | null {
  let enter = 0, exit = 1;
  for (const axis of ['x','y','z'] as const) {
    const d = to[axis] - from[axis];
    if (Math.abs(d) < 1e-12) { if (from[axis] < min[axis] || from[axis] > max[axis]) return null; continue; }
    const a = (min[axis] - from[axis]) / d, b = (max[axis] - from[axis]) / d;
    enter = Math.max(enter, Math.min(a,b)); exit = Math.min(exit, Math.max(a,b));
    if (enter > exit) return null;
  }
  return enter <= 1 && exit >= 0 ? enter : null;
}
const hullSpans = NAVAL_HULL_SECTIONS.slice(0,-1).map(([a,aw], i) => {
  const [b,bw] = NAVAL_HULL_SECTIONS[i+1], za=a*CAPITAL_SHIP.length, zb=b*CAPITAL_SHIP.length;
  const sy=NAVAL_HULL_BOTTOM_INSET/(CAPITAL_SHIP.deckHeight-NAVAL_HULL_BOTTOM), sz=(bw-aw)*CAPITAL_SHIP.width/(zb-za);
  const limit=aw*CAPITAL_SHIP.width-sz*za-sy*CAPITAL_SHIP.deckHeight;
  return [[0,1,0,CAPITAL_SHIP.deckHeight,1],[0,-1,0,-NAVAL_HULL_BOTTOM,1],[0,0,1,zb,1],[0,0,-1,-za,1],
    [1,-sy,-sz,limit,Math.hypot(1,sy,sz)],[-1,-sy,-sz,limit,Math.hypot(1,sy,sz)]];
});
export function sweptShipHit(from: Vec3, to: Vec3, ship: {position:Vec3;previousPosition:Vec3;quaternion:Quat}, padding=0): number|null {
  const q = inverseQuaternion(ship.quaternion);
  const a = transformDirection(sub(from,ship.previousPosition),q), b=transformDirection(sub(to,ship.position),q);
  const broad=segmentBoxHit(a,b,{x:-CAPITAL_SHIP.width/2-padding,y:NAVAL_HULL_BOTTOM-padding,z:-CAPITAL_SHIP.length/2-padding},
    {x:CAPITAL_SHIP.width/2+padding,y:CAPITAL_SHIP.height+padding,z:CAPITAL_SHIP.length/2+padding});
  if(broad===null)return null;
  let first:number|null=null;
  for(const planes of hullSpans){
    let enter=0,exit=1;
    for(const [nx,ny,nz,limit,nlen] of planes){
      const fa=nx*a.x+ny*a.y+nz*a.z-limit-padding*nlen,fb=nx*b.x+ny*b.y+nz*b.z-limit-padding*nlen;
      if(fa>0&&fb>0){enter=2;break;}if(fa<=0&&fb<=0)continue;
      const t=fa/(fa-fb);if(fa>0)enter=Math.max(enter,t);else exit=Math.min(exit,t);if(enter>exit)break;
    }
    if(enter<=exit&&enter<=1&&(first===null||enter<first))first=enter;
  }
  for(const part of NAVAL_STRUCTURE_PARTS){
    const [x,y,z]=part.position,[sx,sy,sz]=part.size,hx=part.shape==='cylinder'?sx:sx/2,hz=part.shape==='cylinder'?sz:sz/2;
    const t=segmentBoxHit(a,b,{x:x-hx-padding,y:y-sy/2-padding,z:z-hz-padding},{x:x+hx+padding,y:y+sy/2+padding,z:z+hz+padding});
    if(t!==null&&(first===null||t<first))first=t;
  }
  return first;
}
/** Constant velocity lead. No positive lifetime-limited intercept means the fallback is retained. */
export function interceptDirection(origin:Vec3,targetPosition:Vec3,targetVelocity:Vec3,speed:number,lifetime:number,fallback?:Vec3):Vec3 {
  const r=sub(targetPosition,origin),a=dot(targetVelocity,targetVelocity)-speed*speed,b=2*dot(r,targetVelocity),c=dot(r,r);
  const defaultDirection=fallback?{...fallback}:normalize(r);let times:number[]=[];
  if(Math.abs(a)<1e-8){if(Math.abs(b)>1e-8)times=[-c/b];}
  else {const disc=b*b-4*a*c;if(disc>=0){const root=Math.sqrt(disc);times=[(-b-root)/(2*a),(-b+root)/(2*a)];}}
  const valid=times.filter(t=>t>0&&t<=lifetime);if(!valid.length)return defaultDirection;
  return normalize(add(r,scale(targetVelocity,Math.min(...valid))));
}
