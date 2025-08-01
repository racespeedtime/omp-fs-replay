import { performance } from "perf_hooks";
import { promises as fs } from "fs";
import { unpack } from "msgpackr";
import path from "path";
import { TickData, ProgressCallback, ReplayConfig, PlayerState } from "./types";
import { TICK_INTERVAL_MS } from "./constants";

export class SegmentedReplayer {
  private segmentSize: number = 1000;
  private totalTicks: number = 0;
  private loadedSegments = new Map<number, TickData[]>();
  private dataDir: string;
  private currentTick = 0;
  private isPlaying = false;
  private isPaused = false;
  private playbackSpeed = 1.0;
  private startTime = 0;
  private timer: NodeJS.Timeout | null = null;
  private onProgress?: ProgressCallback;
  private debug: boolean;
  private tickData: TickData[] = []; // 全量Tick缓存（按需填充）

  constructor(dataDir: string, config: ReplayConfig = {}) {
    this.dataDir = dataDir;
    this.debug = config.debug ?? true;
    this.segmentSize = config.segmentSize || 1000;
  }

  private log(...args: unknown[]) {
    if (this.debug) console.log("[Replayer]", ...args);
  }

  async init(): Promise<void> {
    const header = JSON.parse(
      await fs.readFile(path.join(this.dataDir, "header.json"), "utf-8")
    );
    this.totalTicks = header.totalTicks;
    this.segmentSize = header.segmentSize;
    this.log(`初始化完成，总Tick数: ${this.totalTicks}`);
  }

  async loadSegment(segmentIndex: number): Promise<void> {
    if (this.loadedSegments.has(segmentIndex)) return;

    const segmentPath = path.join(this.dataDir, `segment_${segmentIndex}.dat`);
    const encoded = await fs.readFile(segmentPath);
    const segment = unpack(encoded) as TickData[];
    this.loadedSegments.set(segmentIndex, segment);

    // 填充全量tickData（用于快速跳转）
    const startTick = segmentIndex * this.segmentSize;
    segment.forEach((tick, index) => {
      this.tickData[startTick + index] = tick;
    });

    this.log(`加载段 ${segmentIndex}`);
    this.onProgress?.(
      segmentIndex + 1,
      Math.ceil(this.totalTicks / this.segmentSize)
    );
  }

  private applyState(state: PlayerState[]): void {
    state.forEach((playerState) => {
      if (playerState.isRespawning) {
        playerState.respawnEndTime = performance.now() + 1000;
        this.log(`玩家 ${playerState.id} 重生状态修复`);
      }
    });
  }

  // ------------ 核心回放控制 ------------
  async play(): Promise<void> {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.isPaused = false;
    this.startTime =
      performance.now() -
      (this.currentTick * TICK_INTERVAL_MS) / this.playbackSpeed;
    this.log(`开始播放 (速度: ${this.playbackSpeed}x)`);
    await this.processTick();
  }

  pause(): void {
    if (!this.isPlaying) return;
    this.isPaused = true;
    if (this.timer) clearTimeout(this.timer);
    this.log("已暂停");
  }

  resume(): void {
    if (!this.isPlaying || !this.isPaused) return;
    this.isPaused = false;
    this.startTime =
      performance.now() -
      (this.currentTick * TICK_INTERVAL_MS) / this.playbackSpeed;
    this.log("继续播放");
    this.processTick();
  }

  setSpeed(speed: number): void {
    if (speed <= 0) throw new Error("播放速度必须大于0");
    this.playbackSpeed = speed;
    if (this.isPlaying && !this.isPaused) {
      this.startTime =
        performance.now() -
        (this.currentTick * TICK_INTERVAL_MS) / this.playbackSpeed;
    }
    this.log(`设置播放速度: ${speed}x`);
  }

  // ------------ Tick处理 ------------
  private async processTick(): Promise<void> {
    if (!this.isPlaying || this.isPaused) return;

    const segmentIndex = Math.floor(this.currentTick / this.segmentSize);
    if (!this.loadedSegments.has(segmentIndex)) {
      await this.loadSegment(segmentIndex);
    }

    const frame = this.tickData[this.currentTick];
    if (!frame) {
      this.log("回放结束");
      return;
    }

    // 处理输入（与录制时逻辑一致）
    frame.inputs.forEach(({ playerId, action }) => {
      const player = frame.state.find((p) => p.id === playerId);
      if (!player) return;

      switch (action.type) {
        case "accelerate":
          player.speed += action.value;
          break;
        case "drift":
          player.isDrifting = action.angle > 0;
          break;
        case "respawn":
          player.isRespawning = true;
          player.respawnEndTime = performance.now() + 1000;
          break;
        case "collide":
          player.speed = Math.max(0, player.speed - 10);
          break;
      }
    });

    // 时间控制
    const now = performance.now();
    const expectedTime = frame.time / this.playbackSpeed;
    const actualTime = now - this.startTime;
    const drift = actualTime - expectedTime;

    this.applyState(frame.state);
    this.log(
      `Tick ${frame.tick} ` +
        `(预期: ${expectedTime.toFixed(2)}ms, 实际: ${actualTime.toFixed(
          2
        )}ms, 漂移: ${drift.toFixed(2)}ms)`
    );

    // 下一帧
    this.currentTick++;
    const nextFrame = this.tickData[this.currentTick];
    if (!nextFrame) {
      this.log("回放结束");
      return;
    }

    const nextTickDelay = (nextFrame.time - frame.time) / this.playbackSpeed;
    this.timer = setTimeout(
      () => this.processTick(),
      Math.max(0, nextTickDelay - drift)
    );
  }

  // ------------ 精确控制 ------------
  async seekToTick(tick: number): Promise<boolean> {
    if (tick < 0 || tick >= this.totalTicks) {
      this.log(`非法跳转: Tick ${tick} 超出范围 [0, ${this.totalTicks - 1}]`);
      return false;
    }

    const segmentIndex = Math.floor(tick / this.segmentSize);
    await this.loadSegment(segmentIndex);

    this.currentTick = tick;
    const frame = this.tickData[tick];
    this.applyState(frame.state);
    this.log(`跳转到 Tick ${tick}`);
    return true;
  }

  stepForward() {
    return this.seekToTick(this.currentTick + 1);
  }

  stepBackward() {
    return this.seekToTick(this.currentTick - 1);
  }

  getPlayerState(playerId: number): PlayerState | undefined {
    const frame = this.tickData[this.currentTick];
    return frame?.state.find((p) => p.id === playerId);
  }
}
