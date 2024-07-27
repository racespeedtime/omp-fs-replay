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
  data: IInCarSync;
  additional?: unknown;
}

// todo录制限制最高128 最低32
// todo回放限制最低？反正慢放1/4和快放4x
const recordTickPerSecond = 64;
const recordSingleFileSecond = 10;
const recordTickGap = 1000 / recordTickPerSecond;

const npcWaitingWorld = 8888;

// 这个也要调整的，假设多个玩家看同一个npc的回放，应该取决于不同世界
const npcReadyWorld = 0;

const replayNpcNameStart = "npc_";

const npcPools = new Map<string, Player>();
const freeNpcPools = new Set<Player>();
const npcVehPools = new Map<string, Vehicle["id"]>();

const tickReplayData = new Map<Vehicle["id"], TickReplayData[] | null>();

const recordingVehPlayer = new Map<Vehicle["id"], Player>();
const recordingVehTimeStamp = new Map<Vehicle["id"], number>();
const recordingVehFile = new Map<Vehicle["id"], string>();

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

function readyReplayNpc(vehicle: Vehicle) {
  const randNpc = getRandomNpc();
  if (!randNpc) {
    throw new Error("No free NPCs");
  }
  if (!vehicle.isValid()) {
    throw new Error("Vehicle is not valid");
  }
  freeNpcPools.delete(randNpc);
  randNpc.setVirtualWorld(npcReadyWorld);
  npcVehPools.set(randNpc.getName(), vehicle.id);
  vehicle.putPlayerIn(randNpc, 0);
}

async function readVehicleData(vehicle: Vehicle["id"], tick: number) {
  const dir = recordingVehFile.get(vehicle);
  if (!dir) {
    throw new Error("can't find vehicle recordFile");
  }
  const dataPack = Math.floor(
    (tick / recordTickPerSecond) * recordSingleFileSecond
  );
  const tickFile = path.resolve(dir, `${dataPack}.json`);
  let tickDataArr: TickReplayData[] | void = await fs.readJson(tickFile);
  if (!tickDataArr) tickDataArr = [];
  return tickDataArr;
}

function readTickData(dataArr: TickReplayData[], tick: number) {
  return dataArr.find((item) => item.tick >= tick) || null;
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
  await fs.writeJson(configPath, {
    recordTickPerSecond,
    recordSingleFileSecond,
  });
  recordingVehFile.set(veh.id, filePath);
  recordingVehPlayer.set(veh.id, player);
}

function stopRecordingPlayData(player: Player) {
  // todo 玩家不管在不在车内只要之前有处于录制状态就停止
}

async function recordVehicleData(
  vehicle: Vehicle["id"],
  tick: number,
  data: IInCarSync,
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
    (tick / recordTickPerSecond) * recordSingleFileSecond
  );
  const tickFile = path.resolve(dirPath, `${dataPack}.json`);
  let tickDataArr = await fs.readJson(tickFile);
  if (!tickDataArr) tickDataArr = [];

  const tickDataItem: TickReplayData = { tick, data };
  if (additional) tickDataItem.additional = additional;

  tickDataArr.push(tickDataItem);

  await fs.writeJSON(tickFile, data);
}

PlayerEvent.onStateChange(({ player, newState, oldState, next }) => {
  // todo
  // 如果处于录制状态 oldState === Driver && newState !== Driver
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
  if (name.startsWith(replayNpcNameStart) && npcVehPools.has(name)) {
    npcPools.set(name, player);
    freeNpcPools.add(player);
    player.setVirtualWorld(npcWaitingWorld);
  }

  return next();
});

PlayerEvent.onDisconnect(({ player, next }) => {
  if (!player.isNpc()) return next();
  const name = player.getName();
  if (name.startsWith(replayNpcNameStart) && npcPools.has(name)) {
    // todo 如果处于回放状态 ... 收尾
    // 如果处于录制状态 收尾
    // ....
    npcPools.delete(name);
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
    const lastTimeStamp =
      recordingVehTimeStamp.get(data.vehicleId) || now - recordTickGap;
    const nextTimeStamp = lastTimeStamp + recordTickGap;
    if (now >= nextTimeStamp) {
      recordingVehTimeStamp.set(data.vehicleId, now);
      const tick = nextTimeStamp - now;
      recordVehicleData(data.vehicleId, tick, data);
    }
    return next();
  }

  // 假设载具处于回放状态
  if (1 === 2) {
    // todo回放读取文件tick -> dataPack
    const now = Date.now();
    const lastTimeStamp =
      recordingVehTimeStamp.get(data.vehicleId) || now - recordTickGap;
    const nextTimeStamp = lastTimeStamp + recordTickGap;
    const tick = nextTimeStamp - now;
    if (now >= nextTimeStamp) {
      recordingVehTimeStamp.set(data.vehicleId, now);
      const nextReadFileTimeStamp =
        lastTimeStamp + recordTickPerSecond * recordSingleFileSecond;
      if (now >= nextReadFileTimeStamp) {
        readVehicleData(data.vehicleId, tick).then((tickDataArr) => {
          // const tickData = readTickData(res, tick);
          tickReplayData.set(data.vehicleId, tickDataArr);
        });
      }

      const overWriteData = tickReplayData.get(data.vehicleId);
      if (!overWriteData || !overWriteData.length) {
        // 触发下回调，比如没读到是因为暂停或者下车了，开发者可以更新载具的3D文本标签？
        // callback();
        return false;
      }
      const lastInCarSyncData = readTickData(overWriteData, tick);
      if (!lastInCarSyncData) {
        // 触发下回调，比如没读到是因为暂停或者下车了，开发者可以更新载具的3D文本标签？
        // callback();
        return false;
      }
      inCarSync.writeSync(lastInCarSyncData.data);
      return next();
    }
    return next();
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
  initReplayPools();
  return next();
});

PlayerEvent.onCommandText("record", ({ player, next }) => {
  // todo 如果在录制就停止录制
  const fileName = player.getName() + "/" + Date.now();
  try {
    startRecordingPlayerData(player, fileName);
  } catch (err) {
    player.sendClientMessage("#fff", JSON.stringify(err));
  }
  return next();
});
