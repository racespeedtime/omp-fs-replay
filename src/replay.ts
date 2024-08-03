import {
  Npc,
  Player,
  PlayerEvent,
  PlayerStateEnum,
  Vehicle,
} from "@infernus/core";
import { InCarSync, PacketIdList, onIncomingPacket } from "@infernus/raknet";
import {
  recordingVehPlayer,
  pauseVehPlayer,
  replayNpcNamePrefix,
  waitingNpcPools,
  npcReplayWorldId,
  recordingVehFile,
  replayVehPools,
  recordTickPerSecond,
  recordSingleFileSeconds,
  replayVehTotalTick,
  replayVehData,
  recordingVehStartTime,
  recordingVehTimeStamp,
  pauseVehStartTime,
  pauseVehTimeStamp,
  pauseVehFile,
  npcWaitingWorldId,
  recordTickGap,
  replayVehReadFileTimeStamp,
  replayNpcPools,
} from "./constants";
import { triggerReplayLoseTick, triggerReplayTick } from "./events";
import {
  checkConfig,
  checkNecessary,
  readDataPack,
  readTickData,
  readVehicleData,
  recordVehicleData,
  writeRecordConfig,
} from "./io";

export function getPlayerRecordingVeh(player: Player) {
  for (const item of recordingVehPlayer) {
    if (item[1] === player) return item[0];
  }
  return null;
}

export function getPlayerPauseVeh(player: Player) {
  for (const item of pauseVehPlayer) {
    if (item[1] === player) return item[0];
  }
  return null;
}

export function isPlayerRecording(player: Player) {
  return getPlayerRecordingVeh(player) !== null;
}

export function isPlayerPauseRecording(player: Player) {
  return getPlayerPauseVeh(player) !== null;
}

export async function initReplayPools(size = 1) {
  await checkNecessary();
  await checkConfig();
  for (let i = 0; i < size; i++) {
    Npc.connectNPC(replayNpcNamePrefix + i, "replay_vehicle");
  }
}

export function getRandomNpc() {
  if (!waitingNpcPools.size) return null;
  const random = Math.floor(Math.random() * waitingNpcPools.size);
  return Array.from(waitingNpcPools.values())[random];
}

export function readyReplayNpc(vehicle: Vehicle, fileName: string) {
  const randNpc = getRandomNpc();
  if (!randNpc) {
    throw new Error("No free NPCs");
  }
  if (!vehicle.isValid()) {
    throw new Error("Vehicle is not valid");
  }
  waitingNpcPools.delete(randNpc);
  randNpc.setVirtualWorld(npcReplayWorldId);
  vehicle.putPlayerIn(randNpc, 0);
  recordingVehFile.set(vehicle.id, fileName);
  replayVehPools.set(randNpc.getName(), vehicle.id);
}

export async function startReplayPlayerData(fileName: string) {
  const { filePath, config, dataPack } = await readDataPack(fileName);

  const lastDataPackTick = +dataPack.split("\n").slice(-2)[0];
  if (!lastDataPackTick) {
    throw new Error("can't find last tick data");
  }

  const initVeh = new Vehicle({
    modelId: 411,
    x: 0,
    y: 0,
    z: 3.5,
    zAngle: 0,
    color: [-1, -1],
  });
  initVeh.create();
  replayVehTotalTick.set(initVeh.id, lastDataPackTick);
  replayVehData.set(initVeh.id, null);
  try {
    readyReplayNpc(initVeh, filePath);
  } catch (err) {
    initVeh.destroy();
    throw err;
  }
  return initVeh;
}

export function stopReplayPlayerData(vehicle: Vehicle["id"]) {
  if (!replayVehData.has(vehicle)) {
    throw new Error("vehicle is not in replaying");
  }

  const veh = Vehicle.getInstance(vehicle);
  if (!veh) {
    throw new Error("can't find vehicle instance");
  }

  veh.destroy();

  recordingVehFile.delete(vehicle);
  replayVehData.delete(vehicle);
}

export async function startRecordingPlayerData(
  player: Player,
  fileName: string
) {
  if (!player.isInAnyVehicle()) throw new Error("Player is not in a vehicle");
  if (player.getState() !== PlayerStateEnum.DRIVER) {
    throw new Error("Player is not driver");
  }
  const veh = player.getVehicle(Vehicle.getInstances());
  if (!veh) {
    throw new Error("can't find player vehicle instance");
  }
  if (recordingVehPlayer.has(veh.id)) {
    throw new Error("Vehicle is recording");
  }
  const { filePath } = await writeRecordConfig(fileName, {
    recordTickPerSecond,
    recordSingleFileSeconds,
    // vehicle: {
    //   modelId: veh.getModel(),
    //   color: veh.getColors(),
    // },
  });
  recordingVehFile.set(veh.id, filePath);
  recordingVehPlayer.set(veh.id, player);
}

export function stopRecordingPlayData(player: Player) {
  // todo 玩家不管在不在车内只要之前有处于录制状态就停止
  if (!isPlayerRecording(player) && !isPlayerPauseRecording(player)) {
    throw new Error("Player is not recording");
  }

  for (const item of recordingVehPlayer) {
    if (item[1] === player) {
      const veh = item[0];
      recordingVehPlayer.delete(veh);
      recordingVehStartTime.delete(veh);
      recordingVehTimeStamp.delete(veh);
      recordingVehFile.delete(veh);

      pauseVehPlayer.delete(veh);
      pauseVehStartTime.delete(veh);
      pauseVehTimeStamp.delete(veh);
      pauseVehFile.delete(veh);
      break;
    }
  }
}

PlayerEvent.onStateChange(({ player, newState, oldState, next }) => {
  if (player.isNpc()) return next();

  if (
    oldState === PlayerStateEnum.DRIVER &&
    newState !== PlayerStateEnum.DRIVER
  ) {
    // todo 暂停录制

    const veh = getPlayerRecordingVeh(player);
    if (!veh) return next();

    pauseVehPlayer.set(veh, recordingVehPlayer.get(veh)!);
    pauseVehStartTime.set(veh, recordingVehStartTime.get(veh)!);
    pauseVehTimeStamp.set(veh, recordingVehTimeStamp.get(veh)!);
    pauseVehFile.set(veh, recordingVehFile.get(veh)!);

    recordingVehPlayer.delete(veh);
    recordingVehStartTime.delete(veh);
    recordingVehTimeStamp.delete(veh);
    recordingVehFile.delete(veh);

    // recordCallback();

    return next();
  }

  // 恢复录制 重新赋值vehicleId
  if (
    oldState !== PlayerStateEnum.DRIVER &&
    newState === PlayerStateEnum.DRIVER
  ) {
    const oldVeh = getPlayerPauseVeh(player);
    if (!oldVeh) return next();

    const currentVeh = player.getVehicle(Vehicle.getInstances());
    if (!currentVeh) return next();
    if (currentVeh.id !== oldVeh) {
      // recordCallback();
    }

    recordingVehPlayer.set(currentVeh.id, pauseVehPlayer.get(oldVeh)!);
    recordingVehStartTime.set(currentVeh.id, pauseVehStartTime.get(oldVeh)!);
    recordingVehTimeStamp.set(currentVeh.id, pauseVehTimeStamp.get(oldVeh)!);
    recordingVehFile.set(currentVeh.id, pauseVehFile.get(oldVeh)!);

    pauseVehPlayer.delete(oldVeh);
    pauseVehStartTime.delete(oldVeh);
    pauseVehTimeStamp.delete(oldVeh);
    pauseVehFile.delete(oldVeh);
  }

  // 要暂停那个载具的id的录制，但是一旦玩家又恢复到了载具内的话，要重新赋值载具的id以继续录制

  // 不知道npc能不能触发
  // 如果npc能的话
  // 比如回放结束或者载具被销毁就oldState === Driver && newState !== Driver
  // 重置npc就像onSpawn那样
  return next();
});

function putNpcToWaitingPool(npc: Player) {
  if (!npc.isNpc()) return;

  const name = npc.getName();
  if (!name.startsWith(replayNpcNamePrefix)) return;

  const vehId = replayVehPools.get(name);

  if (vehId) {
    replayNpcPools.delete(name);
    replayVehData.delete(vehId);
    replayVehReadFileTimeStamp.delete(vehId);
    replayVehTotalTick.delete(vehId);

    const veh = Vehicle.getInstance(vehId)!;
    veh.destroy();
  }

  npc.setVirtualWorld(npcWaitingWorldId);
  waitingNpcPools.add(npc);
}

PlayerEvent.onSpawn(({ player, next }) => {
  putNpcToWaitingPool(player);
  return next();
});

PlayerEvent.onDisconnect(({ player, next }) => {
  putNpcToWaitingPool(player);
  return next();
});

onIncomingPacket(({ packetId, bs, next }) => {
  if (packetId !== PacketIdList.DriverSync) return next();
  const inCarSync = new InCarSync(bs);
  const data = inCarSync.readSync();
  if (!data) return next();

  // 假设载具处于录制状态
  if (recordingVehPlayer.has(data.vehicleId)) {
    const now = Date.now();

    let startTime = recordingVehStartTime.get(data.vehicleId);
    if (!startTime) {
      startTime = now;
      recordingVehStartTime.set(data.vehicleId, now);
    }

    const nextTimeStamp = recordingVehTimeStamp.get(data.vehicleId) || now;
    if (now >= nextTimeStamp) {
      recordingVehTimeStamp.set(data.vehicleId, now + recordTickGap);
      const tick = (now - startTime) / recordTickGap;
      console.log(tick);
      // todo 提供一个对外api，用于调用后记录additionData，等下一个tick的时候，传递过去这个addition然后清掉
      recordVehicleData(data.vehicleId, tick, data);
    }
    return next();
  }

  // 假设载具处于回放状态
  if (replayVehData.has(data.vehicleId)) {
    // todo回放读取文件tick -> dataPack
    const now = Date.now();
    let startTime = recordingVehStartTime.get(data.vehicleId);
    if (!startTime) {
      startTime = now;
      recordingVehStartTime.set(data.vehicleId, now);
    }

    const nextTimeStamp = recordingVehTimeStamp.get(data.vehicleId) || now;

    const tick = (now - startTime) / recordTickGap;

    const lastTick = replayVehTotalTick.get(data.vehicleId)!;

    if (tick < lastTick && now >= nextTimeStamp) {
      recordingVehTimeStamp.set(data.vehicleId, now + recordTickGap);

      const nextReadFileTimeStamp =
        replayVehReadFileTimeStamp.get(data.vehicleId) || now;

      if (now >= nextReadFileTimeStamp) {
        replayVehReadFileTimeStamp.set(
          data.vehicleId,
          nextTimeStamp + recordTickPerSecond * recordSingleFileSeconds
        );

        readVehicleData(data.vehicleId, tick).then((tickDataArr) => {
          if (tickDataArr.length) {
            replayVehData.set(data.vehicleId, tickDataArr);
          }
        });
      }
    }

    const overWriteData = replayVehData.get(data.vehicleId);
    if (!overWriteData || !overWriteData.length) {
      // 触发下回调，比如没读到是因为暂停或者下车了，开发者可以更新载具的3D文本标签？
      triggerReplayLoseTick();
      return next();
    }
    const lastInCarSyncData = readTickData(overWriteData, tick);
    if (!lastInCarSyncData || !lastInCarSyncData[1]) {
      // 触发下回调，比如没读到是因为暂停或者下车了，开发者可以更新载具的3D文本标签？
      triggerReplayLoseTick();
      return next();
    }
    // 不能return false不然一直看不到数据包不知道为什么
    const miniData = lastInCarSyncData[1];
    inCarSync.writeSync({
      vehicleId: data.vehicleId,
      lrKey: miniData[0],
      udKey: miniData[1],
      keys: miniData[2],
      quaternion: miniData[3],
      position: miniData[4],
      velocity: miniData[5],
      vehicleHealth: miniData[6],
      playerHealth: 100,
      armour: 0,
      additionalKey: miniData[7],
      weaponId: miniData[8],
      sirenState: miniData[9],
      landingGearState: miniData[10],
      trailerId: 0,
      trainSpeed: miniData[11],
    });
    if (now >= nextTimeStamp && miniData[2]) {
      triggerReplayTick(lastInCarSyncData); // 主要是为了附加数据，如果有附加数据可以换车或者cp点统计数据改变等
    }
    return next();
  }
  return next();
});
