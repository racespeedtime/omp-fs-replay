import { promises as fs } from "fs";
import { SegmentedRecorder } from "./recoder";
import { TICK_INTERVAL_MS } from "./constants";
import { SegmentedReplayer } from "./replayer";

const DATA_DIR = "./scriptfiles/replay_data";

async function setupTestData() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function runFullDemo() {
  // 初始化目录
  await setupTestData()

  // 1. 录制
  const recorder = new SegmentedRecorder(DATA_DIR);
  const players = [1, 2, 3];

  for (let i = 0; i < 3000; i++) { // 模拟100秒（3000 Tick）
    await recorder.addTick({
      tick: i,
      time: i * TICK_INTERVAL_MS,
      inputs: i % 100 === 0 ? [ // 每100 Tick触发加速
        { playerId: 1, action: { type: 'accelerate', value: 5 } }
      ] : [],
      state: players.map(id => ({
        id,
        x: i,
        speed: 10,
        isDrifting: false,
        isRespawning: i === 1500 && id === 2 // 玩家2在Tick 1500重生
      }))
    });
  }
  await recorder.finalize(players);

  // 2. 回放
  const replayer = new SegmentedReplayer(DATA_DIR, { debug: true });
  await replayer.init();

  // 正常播放
  await replayer.play();

  // 5秒后暂停并测试跳转
  setTimeout(async () => {
    replayer.pause();
    console.log('\n--- 测试跳转到玩家2重生时刻 ---');
    await replayer.seekToTick(1500);
    console.log('玩家2状态:', replayer.getPlayerState(2));

    // 逐帧检查
    setTimeout(() => {
      replayer.stepForward();
      console.log('玩家2状态:', replayer.getPlayerState(2));
    }, 500);
  }, 5000);
}

runFullDemo();
