import { performance } from 'node:perf_hooks';
import { promises as fs } from "node:fs";
import path from "node:path";
import { pack } from "msgpackr";
import { ReplayMeta, ReplayConfig } from "./types";
import { HEADER_NAME, SEGMENT_SIZE, TICK_MS } from "./constants";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class Recorder<T = any> {
  private segmentSize: number;
  private tickRate: number;
  private dataDir: string;
  private currentSegment: Map<number, T> = new Map();
  private segmentIndex = 0;
  private state: "idle" | "recording" | "paused" = "idle";
  private startTime: number = 0;
  private lastFlushTick: number = 0;
  private pausedDuration: number = 0;
  private pauseStartTime: number = 0;

  constructor(dataDir: string, config: ReplayConfig = {}) {
    this.dataDir = dataDir;
    this.segmentSize = config.segmentSize || SEGMENT_SIZE;
    this.tickRate = config.tickRate || TICK_MS;
  }

  private getCurrentTick(): number {
    if (this.state !== "recording") return 0;
    const elapsed = performance.now() - this.startTime - this.pausedDuration;
    return Math.floor(elapsed * this.tickRate / 1000);
  }

  async start(): Promise<void> {
    if (this.state !== "idle") {
      throw new Error(`Cannot start in ${this.state} state`);
    }

    await fs.mkdir(this.dataDir, { recursive: true });
    this.startTime = performance.now();
    this.pausedDuration = 0;
    this.lastFlushTick = 0;

    await fs.writeFile(
      path.join(this.dataDir, HEADER_NAME),
      JSON.stringify({
        createdAt: new Date().toISOString(),
        tickRate: this.tickRate,
        segmentSize: this.segmentSize,
        totalTicks: 0,
      } as ReplayMeta)
    );

    this.state = "recording";
  }

  async record(data: T): Promise<void> {
    if (this.state !== "recording") {
      throw new Error(`Cannot record in ${this.state} state`);
    }

    const currentTick = this.getCurrentTick();
    this.currentSegment.set(currentTick, data);

    if (currentTick - this.lastFlushTick >= this.segmentSize) {
      await this.flushSegment();
      this.lastFlushTick = currentTick;
    }
  }

  async pause(): Promise<void> {
    if (this.state !== "recording") {
      throw new Error(`Cannot pause in ${this.state} state`);
    }

    await this.flushSegment();
    this.pauseStartTime = performance.now();
    this.state = "paused";
  }

  async resume(): Promise<void> {
    if (this.state !== "paused") {
      throw new Error(`Cannot resume in ${this.state} state`);
    }

    this.pausedDuration += performance.now() - this.pauseStartTime;
    this.state = "recording";
  }

  private async flushSegment(): Promise<void> {
    const ticks = Array.from(this.currentSegment.keys()).sort((a, b) => a - b);
    if (ticks.length === 0) return;

    const segmentData = {
      firstTick: ticks[0],
      lastTick: ticks[ticks.length - 1],
      data: Object.fromEntries(this.currentSegment),
    };

    await fs.writeFile(
      path.join(this.dataDir, `segment_${this.segmentIndex}.dat`),
      pack(segmentData)
    );

    this.currentSegment.clear();
    this.segmentIndex++;
  }

  async stop(): Promise<ReplayMeta> {
    if (this.state === "idle") {
      throw new Error("Cannot stop when not started");
    }

    if (this.state === "paused") {
      this.pausedDuration += performance.now() - this.pauseStartTime;
    }

    await this.flushSegment();
    const finalTick = this.getCurrentTick();

    const meta: ReplayMeta = JSON.parse(
      await fs.readFile(path.join(this.dataDir, HEADER_NAME), "utf-8")
    );

    meta.totalTicks = finalTick;
    await fs.writeFile(path.join(this.dataDir, HEADER_NAME), JSON.stringify(meta));

    this.state = "idle";
    return meta;
  }
}