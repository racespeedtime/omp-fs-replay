import { promises as fs } from "fs";
import { SegmentedRecorder } from "./recoder";
import { SegmentedReplayer } from "./replayer";

const DATA_DIR = "./scriptfiles/replay_data";

async function setupTestData() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function runFullDemo() {
  await setupTestData();

  // 1. 录制数据
  const recorder = new SegmentedRecorder(DATA_DIR);
  const players = [1, 2, 3, 4, 5, 6];

  for (let i = 0; i < 14400; i++) {
    await recorder.addTick({
      tick: i,
      time: i * (1000 / 30),
      inputs: [],
      state: players.map((id) => ({
        id,
        x: i,
        speed: 10,
        isDrifting: false,
        isRespawning: i === 5000 && id === 1, // 玩家1在Tick 5000重生
      })),
    });
  }
  await recorder.finalize(players);

  // 2. 回放测试
  const replayer = new SegmentedReplayer(DATA_DIR);
  await replayer.init();

  // 正常播放
  await replayer.play();

  // 3秒后暂停并跳转
  setTimeout(async () => {
    replayer.pause();
    console.log("\n--- 跳转到玩家1重生时刻 (Tick 5000) ---");
    await replayer.seekToTick(5000);

    // 检查重生状态
    console.log("玩家1状态:", replayer.getPlayerState(1));

    // 逐帧前进
    setTimeout(() => {
      replayer.stepForward();
      console.log("玩家1状态:", replayer.getPlayerState(1));
    }, 500);
  }, 3000);
}

runFullDemo();
