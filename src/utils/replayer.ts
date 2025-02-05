import * as fs from "fs";
import * as path from "path";
import { createInterface } from "readline";
import { EventEmitter } from "events";

// 定义事件接口
interface Event {
  action: string;
  direction?: string; // 可选字段
  timestamp: number;
  playerId: string; // 添加玩家ID字段以便过滤
}

class PlayerReplayer extends EventEmitter {
  private directory: string;
  private isPaused: boolean = false;
  private pauseResolve: ((value: any) => void) | null = null;
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
    let startTime = Infinity;
    let endTime = -Infinity;

    const files = fs
      .readdirSync(this.directory)
      .filter((file) => file.endsWith(".jsonl"))
      .sort();

    for (const file of files) {
      const filePath = path.join(this.directory, file);
      const fileStream = fs.createReadStream(filePath);
      const rl = createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      let firstLine = true;
      let lastEvent: Event | null = null;

      for await (const line of rl) {
        try {
          const event: Event = JSON.parse(line);

          if (firstLine) {
            startTime = Math.min(startTime, event.timestamp);
            firstLine = false;
          }
          lastEvent = event;
        } catch (err) {
          console.error(`Error parsing line in file ${filePath}:`, err);
          continue;
        }
      }

      if (lastEvent) {
        endTime = Math.max(endTime, lastEvent.timestamp);
      }

      fileStream.on("error", (err) => {
        console.error(`Error reading file ${filePath}:`, err);
      });

      rl.on("close", () => {
        console.log(`Finished processing file ${filePath}`);
      });
    }

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
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 / this.playbackSpeed)
        );

        // 触发事件处理事件
        this.emit("event", event);

        // 如果已经停止，则跳出循环
        if (this.stopped) {
          this.emit("stopped");
          break;
        }
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
      this.pauseResolve(null);
      this.pauseResolve = null;
    }
  }

  /**
   * 停止回放
   */
  public stop(): void {
    this.stopped = true;
    if (this.pauseResolve) {
      this.pauseResolve(null);
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
  if (event.direction) {
    console.log(`Direction: ${event.direction}`);
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
