// import { promises as fs } from "fs";
import { Recorder } from "./recoder";
import { Replayer } from "./replayer";

async function testRecorder() {
  const dataDir = "./scriptfiles/test-record";
  // await fs.rm(dataDir, { recursive: true });

  // 1. 测试录制
  const recorder = new Recorder(dataDir);
  await recorder.start();

  // 录制一些数据
  for (let i = 0; i < 1500; i++) {
    await recorder.record(i, { value: i, timestamp: Date.now() });
  }

  const meta = await recorder.stop();
  console.log("Recorded meta:", meta);

  // 2. 测试回放
  const replayer = new Replayer({
    dataDir,
    speed: 1,
    onEnd: () => console.log("Playback finished"),
    onTick: (data, meta) => {
      console.log(`[${meta.time}ms] Tick ${meta.tick}:`, data);
    },
  });

  // 测试各种操作
  await replayer.play();
  await new Promise((resolve) => setTimeout(resolve, 500));

  replayer.pause();
  console.log("Paused at tick:", replayer.getCurrentTick());
  await new Promise((resolve) => setTimeout(resolve, 1000));

  replayer.resume();
  await new Promise((resolve) => setTimeout(resolve, 500));

  replayer.setSpeed(2.0);
  console.log("Speed changed to:", replayer.getSpeed());
  await new Promise((resolve) => setTimeout(resolve, 500));

  await replayer.seekToTime(1000); // 跳转到1秒位置
  console.log("After seek:", replayer.getCurrentTick());

  replayer.stepForward(5); // 前进5tick
  replayer.stepBackward(3); // 后退3tick

  await new Promise((resolve) => setTimeout(resolve, 1000));
  replayer.stop();
}

testRecorder().catch(console.error);
