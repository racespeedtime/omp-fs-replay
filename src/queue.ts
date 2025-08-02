import { GameMode, Npc } from "@infernus/core";

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
