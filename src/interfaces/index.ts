import { IInCarSync } from "@infernus/raknet";

export interface TickReplayData {
  tick: number;
  data?: IInCarSync;
  additional?: unknown;
}
