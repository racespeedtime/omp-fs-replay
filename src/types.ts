export interface ReplayMeta {
  createdAt: string;
  tickRate: number;
  segmentSize: number;
  totalTicks: number;
  totalDuration: number;
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

export type TickData<T> = {
  data: T;
  meta: TickMeta;
};

export type RangeQueryOptions = {
  /* 时间范围（毫秒）和tick范围二选一 */
  timeRange?: [number, number]; // [startTime, endTime] 单位毫秒
  tickRange?: [number, number]; // [startTick, endTick]
  /* 公共参数 */
  includePartialTicks?: boolean; // 是否包含缺失数据
  chunkSize?: number;           // 分片加载大小（可选）
};
