import { promises as fs } from "fs";
import path from "path";
import { unpack } from "msgpackr";
import { ReplayMeta, TickMeta, PlayOptions } from "./types";
import { HEADER_NAME } from "./constants";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ReplayerOptions<T = any> {
  dataDir: string;
  processTick: (data: T, meta: TickMeta) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class Replayer<T = any> {
  private meta!: ReplayMeta;
  private dataDir: ReplayerOptions<T>["dataDir"];
  private loadedSegments = new Map<number, Map<number, T>>();
  private processTick?: ReplayerOptions<T>["processTick"];
  private currentTimer: NodeJS.Timeout | null = null;
  private currentTick = 0;

  constructor(options: ReplayerOptions<T>) {
    this.dataDir = options.dataDir;
    this.processTick = options.processTick;
  }

  async initialize(): Promise<ReplayMeta> {
    this.meta = JSON.parse(
      await fs.readFile(path.join(this.dataDir, HEADER_NAME), "utf-8")
    );
    return this.meta;
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

  async play(options: PlayOptions = {}): Promise<void> {
    const speed = Math.max(0.1, Math.min(options.speed || 1, 10));
    await this.loadSegment(
      Math.floor(this.currentTick / this.meta.segmentSize)
    );

    const playTick = async () => {
      const result = this.getTickData(this.currentTick);
      if (!result || !this.processTick) {
        options.onEnd?.();
        return;
      }

      this.processTick(result.data, result.meta);
      this.currentTick++;

      const nextResult = this.getTickData(this.currentTick);
      if (!nextResult) {
        options.onEnd?.();
        return;
      }

      const delay = (nextResult.meta.time - result.meta.time) / speed;
      this.currentTimer = setTimeout(playTick, delay);
    };

    playTick();
  }

  async seek(tick: number): Promise<void> {
    this.stop();
    this.currentTick = tick;

    const segmentIndex = Math.floor(tick / this.meta.segmentSize);
    await this.loadSegment(segmentIndex);

    const result = this.getTickData(tick);
    if (result && this.processTick) {
      this.processTick(result.data, result.meta);
    }
  }

  stop(): void {
    if (this.currentTimer) {
      clearTimeout(this.currentTimer);
      this.currentTimer = null;
    }
  }
}
