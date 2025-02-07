import * as fs from "fs";
import * as path from "path";

// 定义事件接口
interface Event {
  action: string;
  value?: string; // 可选字段
  timestamp: number;
  playerId: string; // 添加玩家ID字段以便记录
}

interface PlayerRecorderOptions {
  directory: string;
  flushInterval?: number; // 默认6秒
  newFileInterval?: number; // 默认30秒，如果为0则不分割文件
}

class PlayerRecorder {
  private directory: string;
  private flushInterval: number;
  private newFileInterval: number;
  private queue: Event[] = [];
  private currentFile: string | null = null;
  private stream: fs.WriteStream | null = null;
  private flushTimerId: NodeJS.Timeout | null = null;
  private newFileTimerId: NodeJS.Timeout | null = null;
  private isRecording_: boolean = false;
  private isPaused_: boolean = false;
  private nextFileTimestamp: number = 0;

  /**
   * 构造函数
   * @param options 配置选项对象
   */
  constructor(options: PlayerRecorderOptions) {
    this.directory = options.directory;
    this.flushInterval = options.flushInterval ?? 3 * 1000; // 默认3秒
    this.newFileInterval = options.newFileInterval ?? 30 * 1000; // 默认30秒

    // 校验时间间隔的合理性
    if (!this.validateIntervals()) {
      throw new Error(
        "Invalid intervals provided. Check the values for flushInterval and newFileInterval."
      );
    }
  }

  private validateIntervals(): boolean {
    const minFlushInterval = 0.5 * 1000; // 最低0.5秒
    const maxFlushInterval = 60 * 1000; // 最高60秒
    const minNewFileInterval = 0; // 允许0表示不分割文件
    const maxNewFileInterval = 10 * 60 * 1000; // 最多10分钟

    return (
      this.flushInterval >= minFlushInterval &&
      this.flushInterval <= maxFlushInterval &&
      this.newFileInterval >= minNewFileInterval &&
      this.newFileInterval <= maxNewFileInterval &&
      (this.newFileInterval === 0 || this.newFileInterval >= this.flushInterval)
    );
  }

  /**
   * 初始化方法
   * 创建日志目录并启动新的日志文件和定时器
   */
  public start(): void {
    if(this.isRecording_) return;

    if (!fs.existsSync(this.directory)) {
      fs.mkdirSync(this.directory, { recursive: true });
    }

    this.isRecording_ = true;
    
    this.startNewFile();
    this.scheduleNewFile();
    this.scheduleFlush();
  }

  /**
   * 启动新的日志文件
   */
  private startNewFile(): void {
    if (this.stream) {
      this.stream.end(() => {
        this.createNewFileStream();
      });
    } else {
      this.createNewFileStream();
    }
  }

  private createNewFileStream(): void {
    const timestamp = Date.now();
    const fileName = `${timestamp}.jsonl`;
    this.currentFile = path.join(this.directory, fileName);
    this.stream = fs.createWriteStream(this.currentFile, { flags: "a" });

    // 错误处理
    this.stream.on("error", (err) => {
      console.error(`Error writing to file ${this.currentFile}:`, err);
    });
  }

  /**
   * 设置定时器以每隔指定时间刷新数据
   */
  private scheduleFlush(): void {
    this.flushTimerId = setTimeout(() => {
      this.flush()
        .then(() => {
          if (this.queue.length > 0) {
            this.scheduleFlush();
          }
        })
        .catch((err) => {
          console.error("Error flushing data:", err);
        });
    }, this.flushInterval);
  }

  /**
   * 设置定时器以每隔指定时间创建新的日志文件
   */
  private scheduleNewFile(): void {
    if(this.newFileInterval === 0) return;
    this.newFileTimerId = setTimeout(() => {
      this.startNewFile();
      this.scheduleNewFile();
    }, this.newFileInterval);
  }

  /**
   * 将队列中的所有事件写入当前日志文件
   */
  private async flush(): Promise<void> {
    if (this.stream && this.queue.length > 0) {
      // 写入前根据时间戳排序
      this.queue.sort((a, b) => a.timestamp - b.timestamp);

      for (const event of this.queue) {
        try {
          this.stream.write(JSON.stringify(event) + "\n");
        } catch (err) {
          console.error(
            `Error writing event for player ${event.playerId}:`,
            err
          );
        }
      }
      this.queue.length = 0; // 清空队列
      // 确保所有数据都被写入磁盘
      await new Promise<void>((resolve) => {
        this.stream!.end(() => {
          this.stream = null;
          resolve();
        });
      });
    }
  }

  /**
   * 记录玩家的操作事件
   * @param event 事件对象
   */
  public recordEvent(event: Event): void {
    if (this.isRecording_ && !this.isPaused_) {
      event.timestamp = Date.now();
      this.queue.push(event);
    }
  }

  /**
   * 获取当前是否正在记录事件
   */
  public isRecording(): boolean {
    return this.isRecording_;
  }

  /**
   * 获取当前是否已暂停记录
   */
  public isPaused(): boolean {
    return this.isPaused_;
  }

  /**
   * 暂停记录
   */
  public pause(): void {
    if (!this.isRecording_ || this.isPaused_) return;
    this.isPaused_ = true;
    if (this.flushTimerId) {
      clearTimeout(this.flushTimerId);
      this.flushTimerId = null;
    }
    if (this.newFileTimerId) {
      clearTimeout(this.newFileTimerId);
      this.newFileTimerId = null;
    }
    if(this.newFileInterval > 0) {
      this.nextFileTimestamp = Date.now() + this.newFileInterval
    }
  }

  /**
   * 恢复记录
   */
  public resume(): void {
    if (this.isRecording_ || !this.isPaused_) return;
    this.isPaused_ = false;
    this.flush().then(() => {
      if(this.nextFileTimestamp > 0 && Date.now() >= this.nextFileTimestamp) {
        this.nextFileTimestamp = 0;
        this.startNewFile()
      }
      this.scheduleNewFile(); // 重新调度新文件任务
      this.scheduleFlush(); // 重新调度刷新任务
    });
  }

  /**
   * 关闭记录器，确保所有数据都被正确记录
   */
  public stop(): void {
    if (!this.isRecording_) return;
    this.isRecording_ = false;
    this.isPaused_ = false;
    if (this.flushTimerId) {
      clearTimeout(this.flushTimerId);
      this.flushTimerId = null;
    }
    if (this.newFileTimerId) {
      clearTimeout(this.newFileTimerId);
      this.newFileTimerId = null;
    }
    this.nextFileTimestamp = 0;
    this.flush();
  }
}

// 使用示例
const recorder = new PlayerRecorder({
  directory: path.join(__dirname, "logs"),
});

recorder.start()

function simulatePlayerOperations(playerId: string): void {
  setInterval(() => {
    if (!recorder.isPaused) {
      const actions = ["move", "jump", "attack"];
      const directions = ["up", "down", "left", "right"];
      const action = actions[Math.floor(Math.random() * actions.length)];
      const direction =
        directions[Math.floor(Math.random() * directions.length)];
      recorder.recordEvent({
        action,
        value: direction,
        playerId,
        timestamp: 0,
      });
    }
  }, 100); // 每100毫秒生成一个事件
}

simulatePlayerOperations("player1");
simulatePlayerOperations("player2");

// 其他玩家可以类似地加入
simulatePlayerOperations("player3");
simulatePlayerOperations("player4");
simulatePlayerOperations("player5");
simulatePlayerOperations("player6");
simulatePlayerOperations("player7");
simulatePlayerOperations("player8");
simulatePlayerOperations("player9");
simulatePlayerOperations("player10");

// 模拟暂停和恢复
setTimeout(() => {
  console.log("Pausing recording...");
  recorder.pause();
}, 5000);

setTimeout(() => {
  console.log("Resuming recording...");
  recorder.resume();
}, 10000);

// 关闭记录器（例如在游戏结束时）
setTimeout(() => {
  recorder.stop();
}, 60000); // 运行1分钟后关闭
