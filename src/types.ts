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

export type PlayOptions = {
  speed?: number;
  onEnd?: () => void;
};

export type ReplayConfig = {
  segmentSize?: number;
  tickRate?: number;
  debug?: boolean;
};