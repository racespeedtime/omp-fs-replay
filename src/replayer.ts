import { performance } from "node:perf_hooks";
import { promises as fs } from "node:fs";
import path from "node:path";
import { unpack } from "msgpackr";
import { ReplayMeta, TickMeta, PlayOptions, ReplayerState } from "./types";
import { HEADER_NAME } from "./constants";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class Replayer<T = any> {
  private meta!: ReplayMeta;
  private dataDir: string;
  private loadedSegments = new Map<number, Map<number, T>>();
  private onTick: (data: T, meta: TickMeta) => void;
  private currentTimer: NodeJS.Timeout | null = null;
  private currentTick = 0;
  private state: ReplayerState = ReplayerState.Idle;
  private lastPlayedTickMeta?: TickMeta;
  private currentSpeed = 1.0;
  private onEnd?: () => void;
  private playStartTime = 0;
  private pausedDuration = 0;
  private pauseStartTime = 0;

  constructor(options: PlayOptions<T>) {
    this.dataDir = options.dataDir;
    this.currentSpeed = Math.max(0.1, Math.min(options.speed || 1, 10));
    this.onEnd = options.onEnd;
    this.onTick = options.onTick;
  }

  private getExpectedTick(): number {
    if (this.state !== ReplayerState.Playing) return this.currentTick;
    const elapsed =
      performance.now() - this.playStartTime - this.pausedDuration;
    return Math.floor(
      (elapsed * this.meta.tickRate * this.currentSpeed) / 1000
    );
  }

  async init(): Promise<void> {
    if (this.meta) return;
    this.meta = JSON.parse(
      await fs.readFile(path.join(this.dataDir, HEADER_NAME), "utf-8")
    );
  }

  getState(): ReplayerState {
    return this.state;
  }

  getCurrentTick(): number {
    return this.currentTick;
  }

  getCurrentTime(): number | undefined {
    return this.lastPlayedTickMeta?.time;
  }

  getSpeed(): number {
    return this.currentSpeed;
  }

  private async loadSegment(index: number): Promise<void> {
    if (this.loadedSegments.has(index)) return;
    const { data } = unpack(
      await fs.readFile(path.join(this.dataDir, `segment_${index}.dat`))
    ) as { data: Record<number, T> };
    this.loadedSegments.set(
      index,
      new Map(Object.entries(data).map(([k, v]) => [parseInt(k), v]))
    );
  }

  private getTickData(tick: number): { data: T; meta: TickMeta } | null {
    const segmentIndex = Math.floor(tick / this.meta.segmentSize);
    const segment = this.loadedSegments.get(segmentIndex);
    if (!segment) return null;

    const data = segment.get(tick);
    if (!data) return null;

    return {
      data,
      meta: {
        tick,
        time: (tick / this.meta.tickRate) * 1000,
        segmentIndex,
      },
    };
  }

  private syncToRealTime(): void {
    const expectedTick = this.getExpectedTick();
    if (expectedTick > this.currentTick) {
      this.seek(expectedTick); // 自动追赶
    }
  }

  private scheduleNextTick(): void {
    if (this.state !== ReplayerState.Playing) return;

    const now = performance.now();
    const nextTickTime = this.lastPlayedTickMeta
      ? this.lastPlayedTickMeta.time + 1000 / this.meta.tickRate
      : now;

    const delay = Math.max(0, (nextTickTime - now) / this.currentSpeed);

    this.currentTimer = setTimeout(() => {
      this.currentTick++;
      this.processTickAndScheduleNext();
    }, delay);
  }

  private processTickAndScheduleNext(): void {
    const result = this.getTickData(this.currentTick);
    if (!result) {
      this.stop();
      this.onEnd?.();
      return;
    }

    this.onTick(result.data, result.meta);
    this.lastPlayedTickMeta = result.meta;
    this.syncToRealTime(); // 每帧后检查时间同步
    this.scheduleNextTick();
  }

  async play(): Promise<void> {
    if (this.state === ReplayerState.Playing)
      throw new Error("Already playing");

    await this.init();
    this.state = ReplayerState.Playing;
    this.playStartTime = performance.now();
    this.pausedDuration = 0;

    await this.loadSegment(
      Math.floor(this.currentTick / this.meta.segmentSize)
    );
    this.processTickAndScheduleNext();
  }

  pause(): void {
    if (this.state !== ReplayerState.Playing) throw new Error("Not playing");
    this.state = ReplayerState.Paused;
    this.pauseStartTime = performance.now();
    if (this.currentTimer) clearTimeout(this.currentTimer);
  }

  resume(): void {
    if (this.state !== ReplayerState.Paused) throw new Error("Not paused");
    this.pausedDuration += performance.now() - this.pauseStartTime;
    this.play();
  }

  async seekToTime(time: number): Promise<void> {
    const targetTick = Math.floor((time * this.meta.tickRate) / 1000);
    await this.seek(targetTick);
  }

  async seek(tick: number): Promise<void> {
    this.stop();
    await this.init();
    this.currentTick = Math.max(0, Math.min(tick, this.meta.totalTicks - 1));

    const segmentIndex = Math.floor(this.currentTick / this.meta.segmentSize);
    await this.loadSegment(segmentIndex);

    const result = this.getTickData(this.currentTick);
    if (result) {
      this.onTick(result.data, result.meta);
      this.lastPlayedTickMeta = result.meta;
    }
  }

  setSpeed(speed: number): void {
    if (this.state !== ReplayerState.Playing) {
      throw new Error("Cannot set speed when not playing");
    }

    this.currentSpeed = Math.max(0.1, Math.min(speed, 10));

    if (this.currentTimer) {
      clearTimeout(this.currentTimer);
      this.scheduleNextTick();
    }
  }

  stepForward(ticks: number = 1): void {
    this.seek(this.currentTick + ticks);
  }

  stepBackward(ticks: number = 1): void {
    this.seek(Math.max(0, this.currentTick - ticks));
  }

  stop(): void {
    if (this.currentTimer) {
      clearTimeout(this.currentTimer);
      this.currentTimer = null;
    }
    this.state = ReplayerState.Idle;
  }
}
