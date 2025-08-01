export type PlayerAction =
  | { type: 'accelerate'; value: number }
  | { type: 'drift'; angle: number }
  | { type: 'respawn' }
  | { type: 'collide'; obstacleId: number };

export interface PlayerState {
  id: number;
  x: number;
  speed: number;
  isDrifting: boolean;
  isRespawning: boolean;
  respawnEndTime?: number;
}

export interface TickData {
  tick: number;
  time: number;
  inputs: { playerId: number; action: PlayerAction }[];
  state: PlayerState[];
}

export type ProgressCallback = (loaded: number, total: number) => void;