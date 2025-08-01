export interface ReplayMeta {
  createdAt: string;
  tickRate: number;
  segmentSize: number;
  totalTicks: number;
}

export interface TickMeta {
  tick: number;
  time: number;
  segmentIndex: number;
}

export type PlayOptions<T> = {
  speed?: number;
  dataDir: string;
  onStart?: () => void;
  onEnd?: () => void;
  onTick: (data: T, meta: TickMeta) => void;
};

export type ReplayConfig = {
  segmentSize?: number;
  tickRate?: number;
  debug?: boolean;
};

export enum RecorderState {
  Idle = 'idle',
  Recording = 'recording',
  Paused = 'paused',
}

export enum ReplayerState {
  Idle = 'idle',
  Playing = 'playing',
  Paused = 'paused',
}