import * as fs from "fs";
import * as path from "path";
// import { v4 as uuidv4 } from "uuid";

// 定义事件接口
interface Event {
  action: string;
  value?: string; // 可选字段
  timestamp: number;
  playerId: string; // 添加玩家ID字段以便记录
}

class PlayerRecorder {
  private directory: string;
  private interval: number;
  private queue: Event[] = [];
  private currentFile: string | null = null;
  private stream: fs.WriteStream | null = null;
  private timerId: NodeJS.Timeout | null = null;
  public isPaused: boolean = false;

  /**
   * 构造函数
   * @param directory 日志文件所在的目录路径
   * @param interval 每隔多少毫秒刷新一次数据（默认6000毫秒）
   */
  constructor(directory: string, interval: number = 6000) {
    this.directory = directory;
    this.interval = interval;
    this.init();
  }

  /**
   * 初始化方法
   * 创建日志目录并启动新的日志文件和定时器
   */
  private init(): void {
    if (!fs.existsSync(this.directory)) {
      fs.mkdirSync(this.directory, { recursive: true });
    }
    this.startNewFile();
    this.scheduleFlush();
  }

  /**
   * 启动新的日志文件
   */
  private startNewFile(): void {
    const timestamp = Date.now();
    // const fileName = `${timestamp}-${uuidv4()}.jsonl`;
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
    this.timerId = setTimeout(() => {
      if (!this.isPaused) {
        this.flush()
          .then(() => {
            this.startNewFile();
            this.scheduleFlush();
          })
          .catch((err) => {
            console.error("Error flushing data:", err);
          });
      } else {
        this.scheduleFlush(); // 如果暂停，则重新设置定时器
      }
    }, this.interval);
  }

  /**
   * 将队列中的所有事件写入当前日志文件
   */
  private async flush(): Promise<void> {
    if (this.stream && !this.isPaused) {
      // 写入前根据时间戳排序
      this.queue.sort((a, b) => a.timestamp - b.timestamp);

      for (const event of this.queue) {
        try {
          this.stream!.write(JSON.stringify(event) + "\n");
        } catch (err) {
          console.error(
            `Error writing event for player ${event.playerId}:`,
            err
          );
        }
      }
      this.queue.length = 0; // 清空队列
      // 确保所有数据都被写入磁盘
      await new Promise<void>((resolve, reject) => {
        if (this.stream) {
          this.stream.end(resolve);
        } else {
          reject(new Error("Stream is not initialized"));
        }
      });
    }
  }

  /**
   * 记录玩家的操作事件
   * @param event 事件对象
   */
  public recordEvent(event: Event): void {
    if (!this.isPaused) {
      event.timestamp = Date.now();
      this.queue.push(event);
    }
  }

  /**
   * 暂停记录
   */
  public pause(): void {
    this.isPaused = true;
  }

  /**
   * 恢复记录
   */
  public resume(): void {
    this.isPaused = false;
    this.scheduleFlush(); // 重新调度刷新任务
  }

  /**
   * 关闭记录器，确保所有数据都被正确记录
   */
  public close(): void {
    if (this.timerId) {
      clearTimeout(this.timerId);
    }
    this.flush()
      .then(() => {
        if (this.stream) {
          this.stream.end();
        }
      })
      .catch((err) => {
        console.error("Error closing recorder:", err);
      });
  }
}

// 使用示例
const recorder = new PlayerRecorder(path.join(__dirname, "logs"));

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
  recorder.close();
}, 60000); // 运行1分钟后关闭
