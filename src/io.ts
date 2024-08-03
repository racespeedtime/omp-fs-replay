import fs from "fs-extra";
import path from "path";
import { Vehicle } from "@infernus/core";
import { IInCarSync } from "@infernus/raknet";
import {
  recordSingleFileSeconds,
  recordTickPerSecond,
  recordingVehFile,
} from "./constants";
import { triggerReplayLoseTick } from "./events";
import { TickReplayDataMini } from "./types";

const currentPath = path.resolve(process.cwd());
const replayFolder = path.resolve(currentPath, "scriptfiles", "replays");
fs.ensureDirSync(replayFolder);

export async function readVehicleData(vehicle: Vehicle["id"], tick: number) {
  const dir = recordingVehFile.get(vehicle);
  if (!dir) {
    throw new Error("can't find vehicle recordFile");
  }
  const dataPack = Math.floor(
    tick / recordTickPerSecond / recordSingleFileSeconds
  );
  const tickFile = path.resolve(dir, `${dataPack}.dem`);
  if (!fs.existsSync(tickFile)) {
    triggerReplayLoseTick();
    return [];
  }
  try {
    const tickDataStr: string = await fs.readFile(tickFile, "utf8");
    const tickDataArr: TickReplayDataMini[] = tickDataStr
      .split("\n")
      .slice(0, -1)
      .map((item) => JSON.parse(item));
    return tickDataArr;
  } catch (err) {
    triggerReplayLoseTick();
    return [];
  }
}

export async function readDataPack(fileName: string) {
  const filePath = path.resolve(replayFolder, fileName);
  const configPath = path.resolve(filePath, "config.json");
  // todo 记录下当前情况下的以便于不同的的tick播放和配置不受影响
  const config = await fs.readJson(configPath);

  const fileNames = await fs.readdir(filePath);

  const dataPacks = fileNames
    .filter((filename) => !filename.startsWith("config"))
    .map((filename) => parseInt(filename.replace(/\.dem$/, "")));

  const lastDataPack = Math.max(...dataPacks);

  const dataPack = await fs.readFile(
    path.resolve(filePath, `${lastDataPack}.dem`),
    "utf8"
  );

  return { filePath, config, dataPack };
}

export async function writeRecordConfig(fileName: string, data: any) {
  const filePath = path.resolve(replayFolder, fileName);
  await fs.ensureDir(filePath);
  const configPath = path.resolve(filePath, "config.json");
  // todo 记录下当前情况下的以便于不同的的tick播放和配置不受影响
  await fs.writeJson(
    configPath,
    data,
    { spaces: 2 }
  )
  return { filePath }
}

export function readTickData(dataArr: TickReplayDataMini[], tick: number) {
  const nextTick = dataArr.find((item) => item[0] >= tick);
  if (nextTick) return nextTick;

  for (let i = dataArr.length; i > 0; i--) {
    if (dataArr[i] && dataArr[i][1]) {
      return dataArr[i];
    }
  }
  return null;
}

export async function recordVehicleData(
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
  const tickFile = path.resolve(dirPath, `${dataPack}.dem`);
  // await fs.ensureFile(tickFile);

  const tickData: TickReplayDataMini = [
    tick,
    data
      ? [
        data["lrKey"],
        data["udKey"],
        data["keys"],
        data["quaternion"].map(
          (item) => +item.toFixed(3)
        ) as IInCarSync["quaternion"],
        data["position"].map(
          (item) => +item.toFixed(3)
        ) as IInCarSync["position"],
        data["velocity"].map(
          (item) => +item.toFixed(3)
        ) as IInCarSync["velocity"],
        +data["vehicleHealth"].toFixed(3),
        data["additionalKey"],
        data["weaponId"],
        data["sirenState"],
        data["landingGearState"],
        +data["trainSpeed"].toFixed(3),
      ]
      : null,
  ];

  if (additional) tickData.push(JSON.stringify(additional));

  await fs.writeFile(tickFile, JSON.stringify(tickData) + "\n", { flag: "a" });
}

export async function checkNecessary() {
  const rootFiles = await fs.readdir(currentPath);
  if (!rootFiles.some((file) => ["samp-npc.exe", "samp-npc"].includes(file))) {
    throw new Error("can't find samp-npc file");
  }
  const replayAmx = path.resolve(currentPath, "npcmodes", "replay_vehicle.amx");
  if (!fs.existsSync(replayAmx)) {
    throw new Error(`can't find ${replayAmx}`);
  }
  const replayRec = path.resolve(
    currentPath,
    "npcmodes",
    "recordings",
    "replay_vehicle.rec"
  );
  if (!fs.existsSync(path.resolve(replayRec))) {
    throw new Error(`can't find ${replayRec}`);
  }
}

export async function checkConfig(size = 0) {
  const ompConfig = await fs.readJson(path.resolve(currentPath, "config.json"));
  if (!ompConfig.max_bots || ompConfig.max_bots <= 0) {
    throw new Error("max_bots in config.json is 0");
  } else if (ompConfig.max_bots < size) {
    throw new Error("max_bots in config.json is less than size");
  }
}
