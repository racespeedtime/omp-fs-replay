import * as fs from "fs";
import * as path from "path";
import { createInterface } from "readline";
import { EventEmitter } from "events";

// 定义事件接口
interface Event {
  action: string;
  value?: string; // 可选字段
  timestamp: number;
  playerId: string; // 添加玩家ID字段以便过滤
}

class PlayerReplayer extends EventEmitter {
  private directory: string;
  private isPaused: boolean = false;
  private pauseResolve: (() => void) | null = null;
  private playbackSpeed: number = 1; // 默认播放速度为1倍速
  private stopped: boolean = false; // 是否已停止

  constructor(directory: string) {
    super();
    this.directory = directory;
  }

  /**
   * 设置播放速度
   * @param speed 播放速度（例如0.5表示半速，2表示两倍速）
   */
  public setPlaybackSpeed(speed: number): void {
    if (speed <= 0) {
      throw new Error("Playback speed must be greater than 0");
    }
    this.playbackSpeed = speed;
  }

  /**
   * 获取当前播放速度
   */
  public getPlaybackSpeed(): number {
    return this.playbackSpeed;
  }

  /**
   * 获取日志文件的时间范围（开始和结束的时间戳）
   */
  public async getTimeRange(): Promise<{ startTime: number; endTime: number }> {
    const files = fs
      .readdirSync(this.directory)
      .filter((file) => file.endsWith(".jsonl"))
      .sort();

    if (files.length === 0) {
      throw new Error("No log files found in the directory.");
    }

    const firstFile = path.join(this.directory, files[0]);
    const lastFile = path.join(this.directory, files[files.length - 1]);

    let startTime = Infinity;
    let endTime = -Infinity;

    // Read the first event from the first file to get startTime
    const firstFileStream = fs.createReadStream(firstFile);
    const firstFileReader = createInterface({
      input: firstFileStream,
      crlfDelay: Infinity,
    });

    for await (const line of firstFileReader) {
      try {
        const event: Event = JSON.parse(line);
        startTime = Math.min(startTime, event.timestamp);
        break; // Only need the first event
      } catch (err) {
        console.error(`Error parsing line in file ${firstFile}:`, err);
        continue;
      }
    }

    firstFileStream.on("error", (err) => {
      console.error(`Error reading file ${firstFile}:`, err);
    });

    // Read the last event from the last file to get endTime
    const lastFileStream = fs.createReadStream(lastFile);
    const lastFileReader = createInterface({
      input: lastFileStream,
      crlfDelay: Infinity,
    });

    let lastEvent: Event | null = null;

    for await (const line of lastFileReader) {
      try {
        lastEvent = JSON.parse(line);
      } catch (err) {
        console.error(`Error parsing line in file ${lastFile}:`, err);
        continue;
      }
    }

    if (lastEvent) {
      endTime = Math.max(endTime, lastEvent.timestamp);
    }

    lastFileStream.on("error", (err) => {
      console.error(`Error reading file ${lastFile}:`, err);
    });

    return { startTime, endTime };
  }

  /**
   * 开始回放事件
   * @param options 过滤选项，包括startTime、endTime和playerId
   */
  public async start(options?: {
    startTime?: number;
    endTime?: number;
    playerId?: string;
  }): Promise<void> {
    if (this.stopped) {
      this.resetState();
    }

    try {
      const files = fs
        .readdirSync(this.directory)
        .filter((file) => file.endsWith(".jsonl"))
        .sort();
      let processedEvents = 0;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        await this.processFile(path.join(this.directory, file), options);
        processedEvents++;
        // 触发进度更新事件
        this.emit("progress", {
          currentFile: file,
          totalFiles: files.length,
          processedEvents,
        });
      }

      // 触发完成事件
      this.emit("complete");
    } catch (err) {
      this.emit("error", err);
    }
  }

  /**
   * 按批处理文件，支持并发读取
   * @param filePath 文件路径
   * @param options 过滤选项
   */
  private async processFile(
    filePath: string,
    options?: { startTime?: number; endTime?: number; playerId?: string }
  ): Promise<void> {
    const fileStream = fs.createReadStream(filePath);
    const rl = createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let firstEventProcessed = false;
    let lastTimestamp = 0;

    for await (const line of rl) {
      while (this.isPaused) {
        await new Promise<void>((resolve) => {
          this.pauseResolve = resolve;
        });
      }

      if (this.stopped) {
        this.emit("stopped");
        break;
      }

      try {
        const event: Event = JSON.parse(line);

        // 根据过滤条件跳过不符合要求的事件
        if (options) {
          if (options.startTime && event.timestamp < options.startTime)
            continue;
          if (options.endTime && event.timestamp > options.endTime) continue;
          if (options.playerId && event.playerId !== options.playerId) continue;
        }

        // 触发 ready 事件一次
        if (!firstEventProcessed) {
          this.emit("ready");
          firstEventProcessed = true;
        }

        // 计算延迟时间并等待
        if (lastTimestamp !== 0) {
          const delay = (event.timestamp - lastTimestamp) / this.playbackSpeed;
          // 开setTimeout线程也要时间，如果间隔过短的话直接当同步处理了
          if (delay > 4) {
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }

        // 触发事件处理事件
        this.emit("event", event);

        lastTimestamp = event.timestamp;
      } catch (err) {
        console.error(`Error parsing line in file ${filePath}:`, err);
        continue; // 跳过当前行，继续处理下一行
      }
    }

    // 错误处理
    fileStream.on("error", (err) => {
      console.error(`Error reading file ${filePath}:`, err);
    });

    // 文件处理完成时的日志
    rl.on("close", () => {
      console.log(`Finished processing file ${filePath}`);
    });
  }

  /**
   * 暂停回放
   */
  public pause(): void {
    this.isPaused = true;
  }

  /**
   * 恢复回放
   */
  public resume(): void {
    this.isPaused = false;
    if (this.pauseResolve) {
      this.pauseResolve();
      this.pauseResolve = null;
    }
  }

  /**
   * 停止回放
   */
  public stop(): void {
    this.stopped = true;
    if (this.pauseResolve) {
      this.pauseResolve();
      this.pauseResolve = null;
    }
  }

  /**
   * 重置状态以便可以重新开始回放
   */
  private resetState(): void {
    this.isPaused = false;
    this.pauseResolve = null;
    this.stopped = false;
  }
}

// 使用示例
const replayer = new PlayerReplayer(path.join(__dirname, "logs"));

// 监听事件
replayer.on("event", (event: Event) => {
  console.log(`Replaying action: ${event.action} at ${event.timestamp}`);
  if (event.value) {
    console.log(`Direction: ${event.value}`);
  }
});

replayer.on(
  "progress",
  (progress: {
    currentFile: string;
    totalFiles: number;
    processedEvents: number;
  }) => {
    console.log(
      `Processing file ${progress.currentFile}, ${progress.processedEvents} events processed`
    );
  }
);

replayer.on("complete", () => {
  console.log("Replay completed!");
});

replayer.on("error", (err: Error) => {
  console.error("Error during replay:", err);
});

replayer.on("ready", () => {
  console.log("Ready to start replaying events.");
});

replayer.on("stopped", () => {
  console.log("Replay stopped.");
});

// 获取日志文件的时间范围
replayer.getTimeRange().then(({ startTime, endTime }) => {
  console.log(`Start Time: ${new Date(startTime).toISOString()}`);
  console.log(`End Time: ${new Date(endTime).toISOString()}`);

  // 示例：从某一段时间开始回放
  const startPlaybackTime = startTime + 1000 * 60 * 5; // 从开始时间后5分钟开始
  const endPlaybackTime = endTime - 1000 * 60 * 5; // 在结束时间前5分钟结束

  // 设置播放速度为2倍速
  replayer.setPlaybackSpeed(2);

  // 模拟暂停和恢复
  setTimeout(() => {
    console.log("Pausing...");
    replayer.pause();
  }, 5000);

  setTimeout(() => {
    console.log("Resuming...");
    replayer.resume();
  }, 10000);

  // 模拟停止
  setTimeout(() => {
    console.log("Stopping...");
    replayer.stop();
  }, 15000);

  // 再次开始回放
  setTimeout(() => {
    console.log("Starting replay again...");
    replayer.start({
      startTime: startPlaybackTime,
      endTime: endPlaybackTime,
      playerId: "player1",
    });
  }, 20000);

  replayer.start({
    startTime: startPlaybackTime,
    endTime: endPlaybackTime,
    playerId: "player1",
  });
});
