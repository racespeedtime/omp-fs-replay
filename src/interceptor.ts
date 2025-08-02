import { PlayerEvent } from "@infernus/core";
import { InCarSync, IRPC, PacketIdList } from "@infernus/raknet";

const interceptPlayers = new Set<number>();

IRPC(PacketIdList.DriverSync, ({ playerId, bs, next }) => {
  if (!interceptPlayers.has(playerId)) return next();

  const incarSync = new InCarSync(bs);
  const syncData = incarSync.readSync();

  // 找到对应的recorder并record这个syncData
  console.log(syncData);

  return next();
});

PlayerEvent.onDisconnect(({ player, next }) => {
  if (!interceptPlayers.has(player.id)) return next();

  // 玩家掉线了但是还在录制中..做掉线记录并销毁一些该销毁的

  // 最后移除掉
  interceptPlayers.delete(player.id);

  return next();
});

// 如果玩家状态变更，比如从车辆离开变成行人..或者司机变成乘客等

PlayerEvent.onStateChange(({ player, newState, oldState, next }) => {
  if (!interceptPlayers.has(player.id)) return next();
  console.log(newState, oldState);
  return next();
});

// 其他有可能需要记录的事件……
