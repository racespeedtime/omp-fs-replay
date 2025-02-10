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

interface ProgressEvent {
  fileList: string[];
  totalFiles: number;
  currentFile: string;
  currentEvents: number;
  processedEvents: number;
}

interface ReplayOptions {
  startTime?: number;
  endTime?: number;
  playerIds?: string[];
}

interface CompleteEvent {}

interface ErrorEvent {
  error: Error;
}

interface ReadyEvent {}

interface StoppedEvent {}

interface FileTimeRange {
  startTime: number;
  endTime: number;
}

class PlayerReplayer {
  private directory: string;
  private isPaused_: boolean = false;
  private isPlaying_: boolean = false;
  private isCompleted_: boolean = false;
  private pauseResolve: (() => void) | null = null;
  private playbackSpeed: number = 1; // 默认播放速度为1倍速
  private stopped: boolean = false; // 是否已停止
  private currentTime: number = 0; // 当前播放时间戳
  private files: string[] = []; // 文件路径列表
  private ignoreFiles: string[] = []; // 忽略的文件列表
  private fileTimeRanges: Map<string, FileTimeRange> = new Map();
  private fileEventCount: number = 0; // 总已处理事件数量
  private eventEmitter: EventEmitter = new EventEmitter(); // 内部创建EventEmitter实例

  constructor(directory: string, ignoreFiles?: string[]) {
    this.directory = directory;
    if (ignoreFiles) {
      this.ignoreFiles = ignoreFiles;
    }
  }

  /**
   * 加载目录中的所有日志文件
   */
  private async loadFiles(): Promise<void> {
    try {
      const entries = await fs.promises.readdir(this.directory, {
        withFileTypes: true,
      });
      this.files = entries
        .filter((dirent) => {
          return (
            dirent.isFile() &&
            dirent.name.endsWith(".jsonl") &&
            !this.ignoreFiles.includes(dirent.name)
          );
        })
        .map((dirent) => dirent.name)
        .sort((a, b) => +a.split(".jsonl")[0] - +b.split(".jsonl")[0]);

      if (this.files.length === 0) {
        throw new Error("No log files found in the directory.");
      }
    } catch (err) {
      console.error("Error loading files:", err);
      this.eventEmitter.emit("error", { error: err });
      throw err;
    }
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
   * 获取日志文件的总时间范围（开始和结束的时间戳）
   */
  public async getTimeRange(): Promise<FileTimeRange> {
    if (this.files.length === 0) {
      await this.loadFiles();
    }

    const firstFileCache = this.fileTimeRanges.get(this.files[0]);
    const lastFileCache = this.fileTimeRanges.get(
      this.files[this.files.length - 1]
    );

    if (firstFileCache && lastFileCache) {
      return {
        startTime: firstFileCache.startTime,
        endTime: lastFileCache.endTime,
      };
    }

    const firstFile = path.join(this.directory, this.files[0]);
    const lastFile = path.join(
      this.directory,
      this.files[this.files.length - 1]
    );

    let startTime = 0;
    let endTime = 0;

    // Read the first event from the first file to get startTime
    const firstFileStream = fs.createReadStream(firstFile);
    const firstFileReader = createInterface({
      input: firstFileStream,
      crlfDelay: Infinity,
    });

    for await (const line of firstFileReader) {
      try {
        const event: Event = JSON.parse(line);
        startTime = event.timestamp;
        break; // Only need the first event
      } catch (err) {
        console.error(`Error parsing line in file ${firstFile}:`, err);
        this.eventEmitter.emit("error", { error: err });
        continue;
      }
    }

    firstFileStream.on("error", (err) => {
      console.error(`Error reading file ${firstFile}:`, err);
      this.eventEmitter.emit("error", { error: err });
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
      endTime = lastEvent.timestamp;
    }

    lastFileStream.on("error", (err) => {
      console.error(`Error reading file ${lastFile}:`, err);
      this.eventEmitter.emit("error", { error: err });
    });

    return { startTime, endTime };
  }

  /**
   * 开始回放事件
   * @param options 过滤选项，包括startTime、endTime和playerId
   */
  public async start(options?: ReplayOptions): Promise<void> {
    if (this.stopped) {
      this.resetState();
    }

    if (this.files.length === 0) {
      await this.loadFiles();
    }

    try {
      this.currentTime = options?.startTime ?? 0;
      this.fileEventCount = 0;
      this.isPlaying_ = true;
      this.isCompleted_ = false;

      for (let i = 0; i < this.files.length; i++) {
        const fileName = this.files[i];
        const range = this.fileTimeRanges.get(fileName);
        if (!range || range.startTime >= this.currentTime) {
          await this.processFile(fileName, options);
        }
      }

      // 触发完成事件
      this.isCompleted_ = true;
      this.isPlaying_ = false;
      this.eventEmitter.emit("complete");
    } catch (err) {
      this.isPlaying_ = false;
      this.eventEmitter.emit("error", { error: err });
    }
  }

  /**
   * 按批处理文件，支持并发读取
   * @param fileName 文件路径
   * @param options 过滤选项
   */
  private async processFile(
    fileName: string,
    options?: ReplayOptions
  ): Promise<void> {
    const filePath = path.join(this.directory, fileName);
    const fileStream = fs.createReadStream(filePath);
    const rl = createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    // 错误处理
    fileStream.on("error", (err) => {
      console.error(`Error reading file ${filePath}:`, err);
      this.eventEmitter.emit("error", { error: err });
    });

    // // 文件处理完成时的日志
    // rl.on("close", () => {
    //   console.log(`Finished processing file ${filePath}`);
    // });

    let eventCount = 0;
    let firstEventProcessed = false;

    let startTime = null;
    let endTime = null;

    for await (const line of rl) {
      while (this.isPaused_) {
        await new Promise<void>((resolve) => {
          this.pauseResolve = resolve;
        });
      }

      if (this.stopped) {
        this.isPlaying_ = false;
        this.eventEmitter.emit("stopped");
        break;
      }

      try {
        const event: Event = JSON.parse(line);

        if (!startTime) {
          startTime = event.timestamp;
        }

        endTime = event.timestamp;

        // 根据过滤条件跳过不符合要求的事件
        if (options) {
          if (options.startTime && event.timestamp < options.startTime)
            continue;
          if (options.endTime && event.timestamp > options.endTime) break;
          if (options.playerIds && !options.playerIds.includes(event.playerId))
            continue;
        }

        // 如果当前时间大于事件时间，则跳过该事件
        if (event.timestamp < this.currentTime) {
          continue;
        }

        // 触发 ready 事件一次
        if (!firstEventProcessed) {
          this.eventEmitter.emit("ready");
          firstEventProcessed = true;
        }

        // 计算延迟时间并等待
        if (this.currentTime !== 0) {
          const delay =
            (event.timestamp - this.currentTime) / this.playbackSpeed;
          // 开setTimeout线程也要时间，如果间隔过短的话直接当同步处理了
          if (delay > 4) {
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }

        this.currentTime = event.timestamp;

        // 触发事件处理事件
        this.eventEmitter.emit("event", event);

        // 触发进度更新事件
        eventCount++;
        this.fileEventCount++;

        this.eventEmitter.emit("progress", {
          fileList: this.files,
          totalFiles: this.files.length,
          currentFile: fileName,
          currentEvents: eventCount,
          processedEvents: this.fileEventCount,
        });
      } catch (err) {
        console.error(`Error parsing line in file ${filePath}:`, err);
        this.eventEmitter.emit("error", { error: err });
        continue; // 跳过当前行，继续处理下一行
      }
    }

    if (startTime && endTime) {
      this.fileTimeRanges.set(fileName, { startTime, endTime });
    }
  }

  /**
   * 读取某一个文件里的所有events，只建议用于行数不多的时间敏感低频文件
   */
  public static async getAllEventsFromFile(filePath: string) {
    const events: Event[] = [];
    const fileStream = fs.createReadStream(filePath);
    const rl = createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      try {
        const event: Event = JSON.parse(line);
        events.push(event);
      } catch (err) {
        console.error(`Error parsing line in file ${filePath}:`, err);
        continue; // 跳过当前行，继续处理下一行
      }
    }
    return events;
  }

  static findEventsByPlayerAndAction(
    events: Event[],
    actionCounts: Record<string, number>,
    timestamp: number,
    direction: "before" | "after",
    playerIds?: string[]
  ): Record<string, Record<string, Event[]>> {
    // 对事件按照timestamp排序
    const events_ = events.sort((a, b) => a.timestamp - b.timestamp);

    // 使用二分查找找到最近的时间戳位置
    let nearestIndex = -1;
    if (direction === "before") {
      nearestIndex = this.binarySearchBefore(events_, timestamp);
    } else {
      // direction === 'after'
      nearestIndex = this.binarySearchAfter(events_, timestamp);
    }

    if (nearestIndex === -1) return {}; // 如果没有找到合适的事件

    // 根据direction截取事件
    let filteredEvents: Event[];
    if (direction === "before") {
      filteredEvents = events_.slice(0, nearestIndex + 1); // 包括nearestIndex
    } else {
      // direction === 'after'
      filteredEvents = events_.slice(nearestIndex); // 不包括nearestIndex
    }

    // 如果提供了playerIds，则过滤出这些玩家的所有事件
    if (playerIds && playerIds.length > 0) {
      filteredEvents = filteredEvents.filter((event) =>
        playerIds.includes(event.playerId)
      );
    }

    const result: Record<string, Record<string, Event[]>> = {};

    if (playerIds && playerIds.length > 0) {
      // 如果指定了playerIds，则只处理这些玩家的事件
      for (const playerId of playerIds) {
        result[playerId] = {};
        for (const [action, count] of Object.entries(actionCounts)) {
          result[playerId][action] = [];
          for (const event of filteredEvents) {
            if (
              event.playerId === playerId &&
              event.action === action &&
              result[playerId][action].length < count
            ) {
              result[playerId][action].push(event);
            }
          }
        }
      }
    } else {
      // 不指定playerIds时，遍历所有玩家
      const players = new Set(filteredEvents.map((event) => event.playerId));

      for (const playerId of players) {
        result[playerId] = {};
        for (const [action, count] of Object.entries(actionCounts)) {
          result[playerId][action] = [];
          for (const event of filteredEvents) {
            if (
              event.playerId === playerId &&
              event.action === action &&
              result[playerId][action].length < count
            ) {
              result[playerId][action].push(event);
            }
          }
        }
      }
    }

    return result;
  }

  // 二分查找：找到小于给定时间戳的最大索引
  private static binarySearchBefore(
    events: Event[],
    timestamp: number
  ): number {
    let start = 0;
    let end = events.length - 1;

    while (start <= end) {
      const mid = Math.floor((start + end) / 2);
      if (events[mid].timestamp < timestamp) {
        start = mid + 1;
      } else {
        end = mid - 1;
      }
    }

    return end; // 返回小于timestamp的最大索引
  }

  // 二分查找：找到大于给定时间戳的最小索引
  private static binarySearchAfter(events: Event[], timestamp: number): number {
    let start = 0;
    let end = events.length - 1;

    while (start <= end) {
      const mid = Math.floor((start + end) / 2);
      if (events[mid].timestamp > timestamp) {
        end = mid - 1;
      } else {
        start = mid + 1;
      }
    }

    return start; // 返回大于timestamp的最小索引
  }

  /**
   * 获取当前是否处于暂停状态
   */
  public isPaused(): boolean {
    return this.isPaused_;
  }

  /**
   * 获取当前是否正在播放
   */
  public isPlaying(): boolean {
    return this.isPlaying_;
  }

  /**
   * 获取当前是否已完成回放
   */
  public isCompleted(): boolean {
    return this.isCompleted_;
  }

  /**
   * 暂停回放
   */
  public pause(): void {
    this.isPaused_ = true;
  }

  /**
   * 恢复回放
   */
  public resume(): void {
    this.isPaused_ = false;
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
    this.isPlaying_ = false;
    if (this.pauseResolve) {
      this.pauseResolve();
      this.pauseResolve = null;
    }
  }

  /**
   * 重置状态以便可以重新开始回放
   */
  private resetState(): void {
    this.isPaused_ = false;
    this.isPlaying_ = false;
    this.isCompleted_ = false;
    this.pauseResolve = null;
    this.stopped = false;
    this.currentTime = 0;
    this.fileEventCount = 0;
  }

  /**
   * 前进指定秒数
   * @param seconds 秒数
   */
  public forward(seconds: number): void {
    this.stop();
    const startTime = this.currentTime + seconds * 1000;
    this.start({ startTime }); // 从新的时间戳开始重新播放
  }

  /**
   * 后退指定秒数
   * @param seconds 秒数
   */
  public backward(seconds: number): void {
    this.stop();
    const startTime = Math.max(this.currentTime - seconds * 1000, 0); // 确保不小于0
    this.start({ startTime }); // 从新的时间戳开始重新播放
  }

  /**
   * 从指定秒数播放
   * @param seconds 秒数
   */
  public async seek(seconds: number) {
    this.stop();
    const { startTime } = await this.getTimeRange();
    this.start({ startTime: startTime + Math.min(0, seconds * 1000) }); // 从新的时间戳开始重新播放
  }

  /**
   * 注册事件监听器
   * @param eventName 事件名称
   * @param listener 回调函数
   */
  public on(eventName: "event", listener: (event: Event) => void): this;
  public on(
    eventName: "progress",
    listener: (progress: ProgressEvent) => void
  ): this;
  public on(
    eventName: "complete",
    listener: (event: CompleteEvent) => void
  ): this;
  public on(eventName: "error", listener: (event: ErrorEvent) => void): this;
  public on(eventName: "ready", listener: (event: ReadyEvent) => void): this;
  public on(
    eventName: "stopped",
    listener: (event: StoppedEvent) => void
  ): this;
  public on(
    eventName: string | symbol,
    listener: (...args: any[]) => void
  ): this {
    this.eventEmitter.on(eventName, listener);
    return this;
  }

  /**
   * 单次注册事件监听器
   * @param eventName 事件名称
   * @param listener 回调函数
   */
  public once(eventName: "event", listener: (event: Event) => void): this;
  public once(
    eventName: "progress",
    listener: (progress: ProgressEvent) => void
  ): this;
  public once(
    eventName: "complete",
    listener: (event: CompleteEvent) => void
  ): this;
  public once(eventName: "error", listener: (event: ErrorEvent) => void): this;
  public once(eventName: "ready", listener: (event: ReadyEvent) => void): this;
  public once(
    eventName: "stopped",
    listener: (event: StoppedEvent) => void
  ): this;
  public once(
    eventName: string | symbol,
    listener: (...args: any[]) => void
  ): this {
    this.eventEmitter.once(eventName, listener);
    return this;
  }

  /**
   * 移除事件监听器
   * @param eventName 事件名称
   * @param listener 回调函数
   */
  public removeListener(
    eventName: string | symbol,
    listener: (...args: any[]) => void
  ): this {
    this.eventEmitter.removeListener(eventName, listener);
    return this;
  }

  /**
   * 触发事件
   * @param eventName 事件名称
   * @param args 参数列表
   */
  public emit(eventName: "event", event: Event): boolean;
  public emit(eventName: "progress", progress: ProgressEvent): boolean;
  public emit(eventName: "complete", event: CompleteEvent): boolean;
  public emit(eventName: "error", event: ErrorEvent): boolean;
  public emit(eventName: "ready", event: ReadyEvent): boolean;
  public emit(eventName: "stopped", event: StoppedEvent): boolean;
  public emit(eventName: string | symbol, ...args: any[]): boolean {
    return this.eventEmitter.emit(eventName, ...args);
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

replayer.on("progress", (progress: ProgressEvent) => {
  console.log(
    `Processing file ${progress.currentFile}, ${progress.processedEvents} events processed`
  );
});

replayer.on("complete", () => {
  console.log("Replay completed!");
});

replayer.on("error", (event: ErrorEvent) => {
  console.error("Error during replay:", event.error);
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
      playerIds: ["player1"],
    });
  }, 20000);

  replayer.start({
    startTime: startPlaybackTime,
    endTime: endPlaybackTime,
    // playerIds: "player1",
  });
});
