import fs from "fs-extra";
import path from "path";
import {
  GameMode,
  Npc,
  Player,
  PlayerEvent,
  PlayerStateEnum,
  Vehicle,
} from "@infernus/core";
import {
  IInCarSync,
  InCarSync,
  PacketIdList,
  onIncomingPacket,
  onIncomingRPC,
  onOutgoingPacket,
  onOutgoingRPC,
} from "@infernus/raknet";

interface TickReplayData {
  tick: number;
  data?: IInCarSync;
  additional?: unknown;
}

// todo录制限制最高64 最低32
// todo回放限制最低？反正慢放1/4和快放4x
const recordTickPerSecond = 32;
const recordSingleFileSeconds = 10;
const recordTickGap = 1000 / recordTickPerSecond;

const npcWaitingWorld = 8888;

// 这个也要调整的，假设多个玩家看同一个npc的回放，应该取决于不同世界
const npcReadyWorld = 0;

const replayNpcNameStart = "npc_";

const replayNpcPools = new Map<string, Player>();
const replayVehPools = new Map<string, Vehicle["id"]>();
const freeNpcPools = new Set<Player>();

const replayVehData = new Map<Vehicle["id"], TickReplayData[] | null>();

const recordingVehPlayer = new Map<Vehicle["id"], Player>();
const recordingVehStartTime = new Map<Vehicle["id"], number>();
const recordingVehTimeStamp = new Map<Vehicle["id"], number>();
const recordingVehFile = new Map<Vehicle["id"], string>();

const pauseVehPlayer = new Map<Vehicle["id"], Player>();
const pauseVehStartTime = new Map<Vehicle["id"], number>();
const pauseVehTimeStamp = new Map<Vehicle["id"], number>();
const pauseVehFile = new Map<Vehicle["id"], string>();

function getPlayerRecordingVeh(player: Player) {
  for (const item of recordingVehPlayer) {
    if (item[1] === player) return item[0];
  }
  return null;
}

function getPlayerPauseVeh(player: Player) {
  for (const item of pauseVehPlayer) {
    if (item[1] === player) return item[0];
  }
  return null;
}

function isPlayerRecording(player: Player) {
  return getPlayerRecordingVeh(player) !== null;
}

function isPlayerPauseRecording(player: Player) {
  return getPlayerPauseVeh(player) !== null;
}

const replayFolder = path.resolve(process.cwd(), "scriptfiles", "replays");
fs.ensureDirSync(replayFolder);

function initReplayPools(size = 1) {
  // todo
  // 检测samp-npc.exe/samp-npc是否存在
  // 检测npcmodes/replay_vehicle.amx和子文件夹replay_vehicle.rec是否存在
  // 检测config.json的max_bots是否为0
  for (let i = 0; i < size; i++) {
    Npc.connectNPC(replayNpcNameStart + i, "replay_vehicle");
  }
}

function getRandomNpc() {
  if (!freeNpcPools.size) return null;
  const random = Math.floor(Math.random() * freeNpcPools.size);
  return Array.from(freeNpcPools.values())[random];
}

function readyReplayNpc(vehicle: Vehicle, fileName: string) {
  const randNpc = getRandomNpc();
  if (!randNpc) {
    throw new Error("No free NPCs");
  }
  if (!vehicle.isValid()) {
    throw new Error("Vehicle is not valid");
  }
  freeNpcPools.delete(randNpc);
  randNpc.setVirtualWorld(npcReadyWorld);
  vehicle.putPlayerIn(randNpc, 0);
  recordingVehFile.set(vehicle.id, fileName);
  replayVehPools.set(randNpc.getName(), vehicle.id);
}

async function readVehicleData(vehicle: Vehicle["id"], tick: number) {
  const dir = recordingVehFile.get(vehicle);
  if (!dir) {
    throw new Error("can't find vehicle recordFile");
  }
  const dataPack = Math.floor(
    tick / recordTickPerSecond / recordSingleFileSeconds
  );
  const tickFile = path.resolve(dir, `${dataPack}.json`);
  let tickDataStr: string = await fs.readFile(tickFile, 'utf8');
  const lines = tickDataStr.split('\n');
  tickDataStr = (lines.map((item, index) => {
    return index >= lines.length - 1 ? item : item + ','
  }).join("\n"))
  console.log(tickDataStr)
  return JSON.parse(tickDataStr);
}

function readTickData(dataArr: TickReplayData[], tick: number) {
  return dataArr.find((item) => item.tick >= tick) || null;
}

async function startReplayPlayerData(fileName: string) {
  const filePath = path.resolve(replayFolder, fileName);
  const configPath = path.resolve(filePath, "config.json");
  // todo 记录下当前情况下的以便于不同的的tick播放和配置不受影响
  const { recordTickPerSecond, recordSingleFileSeconds, vehicle } =
    await fs.readJson(configPath);

  const initVeh = new Vehicle({
    modelId: 411,
    x: 0,
    y: 0,
    z: 3.5,
    zAngle: 0,
    color: [-1, -1],
  });
  initVeh.create();
  replayVehData.set(initVeh.id, null)
  readyReplayNpc(initVeh, filePath);
  return initVeh;
}

function stopReplayPlayerData(vehicle: Vehicle["id"]) {
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

async function startRecordingPlayerData(player: Player, fileName: string) {
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
  const filePath = path.resolve(replayFolder, fileName);
  await fs.ensureDir(filePath);
  const configPath = path.resolve(filePath, "config.json");
  // todo 记录下当前情况下的以便于不同的的tick播放和配置不受影响
  await fs.writeJson(
    configPath,
    {
      recordTickPerSecond,
      recordSingleFileSeconds,
      vehicle: {
        modelId: veh.getModel(),
        color: veh.getColors(),
      },
    },
    { spaces: 2 }
  );
  recordingVehFile.set(veh.id, filePath);
  recordingVehPlayer.set(veh.id, player);
}

function stopRecordingPlayData(player: Player) {
  // todo 玩家不管在不在车内只要之前有处于录制状态就停止
  if (!isPlayerRecording(player) || !isPlayerPauseRecording(player)) {
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

async function recordVehicleData(
  vehicle: Vehicle["id"],
  tick: number,
  data?: IInCarSync,
  additional?: unknown
) {
  const dirPath = recordingVehFile.get(vehicle);
  if (!dirPath) {
    throw new Error("can't find player vehicle instance or recordFileName");
  }

  // 切割文件用 后面乘的越多，单个文件的大小越大，不过这也有问题，就是如果后续修改的话
  // 假设我要读一个特定的>=某个tick的文件，就需要遍历所有文件
  // 如果是固定值的话就可以直接定位到某个文件
  const dataPack = Math.floor(
    tick / recordTickPerSecond / recordSingleFileSeconds
  );
  const tickFile = path.resolve(dirPath, `${dataPack}.json`);
  // await fs.ensureFile(tickFile);

  const tickData: TickReplayData = { tick, data };
  if (additional) tickData.additional = additional;

  await fs.writeJSON(tickFile, tickData, { flag: "a" });
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

    recordCallback();

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
      recordCallback();
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

PlayerEvent.onSpawn(({ player, next }) => {
  if (!player.isNpc()) return next();

  const name = player.getName();
  if (name.startsWith(replayNpcNameStart) && !replayVehPools.has(name)) {
    replayNpcPools.set(name, player);
    freeNpcPools.add(player);
    player.setVirtualWorld(npcWaitingWorld);
  }

  return next();
});

PlayerEvent.onDisconnect(({ player, next }) => {
  if (!player.isNpc()) return next();
  const name = player.getName();
  if (name.startsWith(replayNpcNameStart) && replayNpcPools.has(name)) {
    // todo 如果处于回放状态 ... 收尾
    // 如果处于录制状态 收尾
    // ....
    replayNpcPools.delete(name);
    freeNpcPools.delete(player);
  }
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
    if (now >= nextTimeStamp) {
      recordingVehTimeStamp.set(data.vehicleId, now + recordTickGap);
      // const nextReadFileTimeStamp =
      //   nextTimeStamp + recordTickPerSecond * recordSingleFileSeconds;
      const tick = (now - startTime) / recordTickGap;

      // if (now >= nextReadFileTimeStamp) {
        readVehicleData(data.vehicleId, tick).then((tickDataArr) => {
          // const tickData = readTickData(res, tick);
          replayVehData.set(data.vehicleId, tickDataArr);
        });
      // }

      const overWriteData = replayVehData.get(data.vehicleId);
      if (!overWriteData || !overWriteData.length) {
        // 触发下回调，比如没读到是因为暂停或者下车了，开发者可以更新载具的3D文本标签？
        replayCallback();
        return false;
      }
      const lastInCarSyncData = readTickData(overWriteData, tick);
      if (!lastInCarSyncData || !lastInCarSyncData.data) {
        // 触发下回调，比如没读到是因为暂停或者下车了，开发者可以更新载具的3D文本标签？
        replayCallback();
        return false;
      }
      inCarSync.writeSync(lastInCarSyncData.data);
      replayCallback(); // 主要是为了附加数据，如果有附加数据可以换车或者cp点统计数据改变等
      return next();
    }

    return false;
  }
  return next();
});

onIncomingRPC(({ next }) => {
  return next();
});

onOutgoingPacket(({ next }) => {
  return next();
});

onOutgoingRPC(({ next }) => {
  return next();
});

GameMode.onInit(({ next }) => {
  const veh = new Vehicle({
    modelId: 411,
    x: 0,
    y: 0,
    z: 3,
    color: [-1, -1],
    zAngle: 0,
  });
  veh.create();
  veh.addComponent(1010);

  initReplayPools();
  return next();
});

PlayerEvent.onCommandText("record", async ({ player, next }) => {
  if (isPlayerRecording(player) || isPlayerPauseRecording(player)) {
    stopRecordingPlayData(player);
    return next();
  }
  const fileName = player.getName() + "/" + Date.now();
  try {
    await startRecordingPlayerData(player, fileName);
  } catch (err) {
    player.sendClientMessage("#ff0", JSON.stringify(err));
  }
  return next();
});

PlayerEvent.onCommandText("replay", async ({ player, subcommand, next }) => {
  if (isPlayerRecording(player) || isPlayerPauseRecording(player)) {
    player.sendClientMessage("#ff0", "请先停止录制");
    return next();
  }
  const recordDir = subcommand.join("/");
  if(!recordDir) {
    player.sendClientMessage("#ff0", "请输入回放文件夹");
    return next();
  }
  try {
    const veh = await startReplayPlayerData(recordDir);
    if (veh) {
      player.toggleSpectating(true);
      player.spectateVehicle(veh);
    }
  }
  catch(err: any) {
    player.sendClientMessage("#ff0", err.message)
  }
  return next();
});


PlayerEvent.onConnect(({player, next}) => {
  if(player.isNpc()) return next();
  player.charset = 'gbk'
  return next();
})

function replayCallback() {}
function recordCallback() {}
