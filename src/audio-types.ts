import type { Quaternion, Vector3 } from 'three';
/** Narrow sound adapter; independent of combat state and finite entity identifiers. */
export interface Aircraft {
  id: number;
  position: Vector3;
  quaternion: Quaternion;
  health: number;
  age: number;
  speed: number;
}
export interface GameEvent {
  id: number;
  tick?: number;
  type: 'shot' | 'hit' | 'kill' | 'damage' | 'loop';
  position: Vector3;
  owner: number;
  detail?: string;
  mountId?: string;
}
