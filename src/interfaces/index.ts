import { IInCarSync } from "@infernus/raknet";

export interface TickReplayData {
  tick: number;
  data?: IInCarSync;
  additional?: unknown;
}

export interface RecordingRecover {
  startTime: number,
  timeStamp: number,
  fileName: string
}