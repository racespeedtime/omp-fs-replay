// todo录制限制最高64 最低32

import { TickReplayDataMini } from "@/types";
import { Player, Vehicle } from "@infernus/core";

// todo回放限制最低？反正慢放1/4和快放4x
export const recordTickPerSecond = 32;
export const recordSingleFileSeconds = 10;
export const recordTickGap = 1000 / recordTickPerSecond;

export const npcWaitingWorldId = 8888;
// 这个也要调整的，假设多个玩家看同一个npc的回放，应该取决于不同世界
export const npcReplayWorldId = 0;

export const replayNpcNamePrefix = "npc_";

export const waitingNpcPools = new Set<Player>();

export const replayNpcPools = new Map<string, Player>();
export const replayVehPools = new Map<string, Vehicle["id"]>();
export const replayVehData = new Map<
  Vehicle["id"],
  TickReplayDataMini[] | null
>();
export const replayVehReadFileTimeStamp = new Map<Vehicle["id"], number>();
export const replayVehTotalTick = new Map<Vehicle["id"], number>();

export const recordingVehPlayer = new Map<Vehicle["id"], Player>();
export const recordingVehStartTime = new Map<Vehicle["id"], number>();
export const recordingVehTimeStamp = new Map<Vehicle["id"], number>();
export const recordingVehFile = new Map<Vehicle["id"], string>();

export const recordOrPauseAdditional = new Map<Vehicle["id"], string>();

export const pauseVehPlayer = new Map<Vehicle["id"], Player>();
export const pauseVehStartTime = new Map<Vehicle["id"], number>();
export const pauseVehTimeStamp = new Map<Vehicle["id"], number>();
export const pauseVehFile = new Map<Vehicle["id"], string>();

