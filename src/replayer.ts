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
  private onStart?: () => void;

  constructor(options: PlayOptions<T>) {
    this.dataDir = options.dataDir;
    this.currentSpeed = Math.max(0.1, Math.min(options.speed || 1, 10));
    this.onStart = options.onStart
    this.onEnd = options.onEnd;
    this.onTick = options.onTick;
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

    const meta: TickMeta = {
      tick,
      time: (tick / this.meta.tickRate) * 1000,
      segmentIndex,
    };

    return { data, meta };
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

  private scheduleNextTick(): void {
    if (this.state !== ReplayerState.Playing) return;

    const currentResult = this.getTickData(this.currentTick);
    const nextResult = this.getTickData(this.currentTick + 1);

    if (!currentResult || !nextResult) {
      this.stop();
      this.onEnd?.();
      return;
    }

    const delay =
      (nextResult.meta.time - currentResult.meta.time) / this.currentSpeed;
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

    this.scheduleNextTick();
  }

  async play(): Promise<void> {
    if (this.state === ReplayerState.Playing) {
      throw new Error("Already playing");
    }

    await this.init();
    this.state = ReplayerState.Playing;

    await this.loadSegment(
      Math.floor(this.currentTick / this.meta.segmentSize)
    );

    const initialResult = this.getTickData(this.currentTick);
    if (initialResult) {
      this.onStart?.();
      this.onTick(initialResult.data, initialResult.meta);
      this.lastPlayedTickMeta = initialResult.meta;
      this.currentTick++;
    }

    this.scheduleNextTick();
  }

  pause(): void {
    if (this.state !== ReplayerState.Playing) {
      throw new Error("Cannot pause when not playing");
    }

    this.state = ReplayerState.Paused;
    if (this.currentTimer) {
      clearTimeout(this.currentTimer);
      this.currentTimer = null;
    }
  }

  resume(): void {
    if (this.state !== ReplayerState.Paused) {
      throw new Error("Cannot resume when not paused");
    }

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
