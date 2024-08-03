import {
  initReplayPools,
  isPlayerRecording,
  isPlayerPauseRecording,
  stopRecordingPlayData,
  startRecordingPlayerData,
  startReplayPlayerData,
} from "@/replay";
import { GameMode, Vehicle, PlayerEvent } from "@infernus/core";

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
  } catch (err: any) {
    player.sendClientMessage("#ff0", err.message);
  }
  return next();
});

PlayerEvent.onCommandText("replay", async ({ player, subcommand, next }) => {
  if (isPlayerRecording(player) || isPlayerPauseRecording(player)) {
    player.sendClientMessage("#ff0", "请先停止录制");
    return next();
  }
  const recordDir = subcommand.join("/");
  if (!recordDir) {
    player.sendClientMessage("#ff0", "请输入回放文件夹");
    return next();
  }
  try {
    const veh = await startReplayPlayerData(recordDir);
    if (veh) {
      player.toggleSpectating(true);
      player.spectateVehicle(veh);
    }
  } catch (err: any) {
    player.sendClientMessage("#ff0", err.message);
  }
  return next();
});

PlayerEvent.onConnect(({ player, next }) => {
  if (player.isNpc()) return next();
  player.charset = "gbk";
  return next();
});
