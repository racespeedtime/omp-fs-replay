import { performance } from "perf_hooks";
import { promises as fs } from "fs";
import { unpack } from "msgpackr";
import path from "path";
import { TickData, ProgressCallback, PlayerState } from "./types";

const TICK_INTERVAL_MS = 1000 / 30; // 30 Tick/s

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

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  async init(): Promise<void> {
    const header = JSON.parse(
      await fs.readFile(path.join(this.dataDir, "header.json"), "utf-8")
    );
    this.totalTicks = header.totalTicks;
    this.segmentSize = header.segmentSize;
  }

  async loadSegment(segmentIndex: number): Promise<void> {
    if (this.loadedSegments.has(segmentIndex)) return;

    const segmentPath = path.join(this.dataDir, `segment_${segmentIndex}.dat`);
    const encoded = await fs.readFile(segmentPath);
    this.loadedSegments.set(segmentIndex, unpack(encoded) as TickData[]);

    this.onProgress?.(
      segmentIndex + 1,
      Math.ceil(this.totalTicks / this.segmentSize)
    );
  }

  async seekToTick(tick: number): Promise<boolean> {
    const segmentIndex = Math.floor(tick / this.segmentSize);
    if (
      segmentIndex < 0 ||
      segmentIndex >= Math.ceil(this.totalTicks / this.segmentSize)
    ) {
      console.error(`非法跳转: Tick ${tick} 超出范围`);
      return false;
    }

    await this.loadSegment(segmentIndex);
    const segment = this.loadedSegments.get(segmentIndex)!;
    const frame = segment[tick % this.segmentSize];

    this.currentTick = tick;
    this.applyState(frame.state);
    return true;
  }

  private applyState(state: PlayerState[]): void {
    state.forEach((playerState) => {
      if (playerState.isRespawning) {
        playerState.respawnEndTime = performance.now() + 1000;
        console.log(`玩家 ${playerState.id} 重生状态已修复`);
      }
      console.log(
        `Tick ${this.currentTick}: 玩家${playerState.id} x=${playerState.x}`
      );
    });
  }

  async play(): Promise<void> {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.isPaused = false;
    this.startTime =
      performance.now() -
      (this.currentTick * TICK_INTERVAL_MS) / this.playbackSpeed;
    await this.processTick();
  }

  pause(): void {
    this.isPaused = true;
    if (this.timer) clearTimeout(this.timer);
  }

  resume(): void {
    if (!this.isPlaying || !this.isPaused) return;
    this.isPaused = false;
    this.startTime =
      performance.now() -
      (this.currentTick * TICK_INTERVAL_MS) / this.playbackSpeed;
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
  }

  private async processTick(): Promise<void> {
    if (!this.isPlaying || this.isPaused) return;

    const segmentIndex = Math.floor(this.currentTick / this.segmentSize);
    if (!this.loadedSegments.has(segmentIndex)) {
      await this.loadSegment(segmentIndex);
    }

    const segment = this.loadedSegments.get(segmentIndex)!;
    const frame = segment[this.currentTick % this.segmentSize];
    if (!frame) {
      console.log("回放结束");
      return;
    }

    const now = performance.now();
    const expectedTime = frame.time / this.playbackSpeed;
    const actualTime = now - this.startTime;
    const drift = actualTime - expectedTime;

    this.applyState(frame.state);
    console.log(
      `[回放] Tick ${frame.tick} (预期: ${expectedTime.toFixed(
        2
      )}ms, 实际: ${actualTime.toFixed(2)}ms, 漂移: ${drift.toFixed(2)}ms)`
    );

    this.currentTick++;
    const nextFrame = this.tickData[this.currentTick];
    if (!nextFrame) {
      console.log("回放结束");
      return;
    }

    const nextTickDelay = (nextFrame.time - frame.time) / this.playbackSpeed;
    this.timer = setTimeout(
      () => this.processTick(),
      Math.max(0, nextTickDelay - drift)
    );
  }

  stepForward() {
    return this.seekToTick(this.currentTick + 1);
  }

  stepBackward() {
    return this.seekToTick(this.currentTick - 1);
  }

  getPlayerState(playerId: number) {
    const segmentIndex = Math.floor(this.currentTick / this.segmentSize);
    const segment = this.loadedSegments.get(segmentIndex);
    if (!segment) return undefined;
    const frame = segment[this.currentTick % this.segmentSize];
    return frame.state.find((p) => p.id === playerId);
  }
}
