import { GameMode, Npc } from "@infernus/core";
import { IRPC, PacketIdList } from "@infernus/raknet";

const NPC_POOL_SIZE = 30;
export const npcQueue = new Map<number, ReplayNpc>();

class ReplayNpc {
  npc: Npc;

  constructor(npc: Npc) {
    this.npc = npc;
  }

  destroy() {
    this.npc.destroy();
  }
}

GameMode.onInit(({ next }) => {
  for (let i = 0; i < NPC_POOL_SIZE; i++) {
    const npc = new Npc("");
    if (typeof npc.id === "undefined" || npc.id === -1) {
      npcQueue.forEach((npcInst) => npcInst.destroy());
      npcQueue.clear();
      throw new Error("wtf?");
    }
    npcQueue.set(npc.id, new ReplayNpc(npc));
  }

  return next();
});

GameMode.onExit(({ next }) => {
  npcQueue.forEach((npcInst) => npcInst.destroy());
  npcQueue.clear();
  return next();
});

// 拦截掉可能产生的npc心跳包移动数据，后续我们手动模拟npc数据不会进入到这里
IRPC(PacketIdList.OnFootSync, ({ playerId, next }) => {
  if (npcQueue.has(playerId)) {
    return false;
  }
  return next();
});

IRPC(PacketIdList.DriverSync, ({ playerId, next }) => {
  if (npcQueue.has(playerId)) {
    return false;
  }
  return next();
});
