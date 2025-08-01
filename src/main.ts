import { Recorder } from "./recoder";
import { Replayer } from "./replayer";

(async () => {
  // 初始化
  const recorder = new Recorder('./recordings', { debug: true });
  const replayer = new Replayer(
    './recordings',
    processInputs,  // 用户实现的输入处理
    applyState,      // 用户实现的状态应用
    { debug: true }
  );

  // 录制
  recorder.start();
  recorder.addInput(1, { type: 'accelerate', value: 10 });
  await recorder.stop();

  // 回放
  await replayer.init(initialState);
  await replayer.play();

  // 跳转测试
  setTimeout(() => {
    replayer.seekToTick(500); // 直接计算并应用目标状态
  }, 2000);
})()