import { promises as fs } from "node:fs";
import path from "node:path";
import { pack } from "msgpackr";
import { ReplayMeta, ReplayConfig, RecorderState } from "./types";
import { HEADER_NAME, SEGMENT_SIZE, TICK_MS } from "./constants";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class Recorder<T = any> {
  private segmentSize: number;
  private tickRate: number;
  private dataDir: string;
  private currentSegment: Map<number, T> = new Map();
  private segmentIndex = 0;
  private state: RecorderState = RecorderState.Idle;
  private pausedData: { lastTick?: number } = {};

  constructor(dataDir: string, config: ReplayConfig = {}) {
    this.dataDir = dataDir;
    this.segmentSize = config.segmentSize || SEGMENT_SIZE;
    this.tickRate = config.tickRate || TICK_MS;
  }

  getState(): RecorderState {
    return this.state;
  }

  getCurrentSegmentSize(): number {
    return this.currentSegment.size;
  }

  async start(): Promise<void> {
    if (this.state !== RecorderState.Idle) {
      throw new Error(`Cannot start recording in ${this.state} state`);
    }

    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.writeFile(
      path.join(this.dataDir, HEADER_NAME),
      JSON.stringify({
        createdAt: new Date().toISOString(),
        tickRate: this.tickRate,
        segmentSize: this.segmentSize,
        totalTicks: 0,
      } as ReplayMeta)
    );

    this.state = RecorderState.Recording;
    this.segmentIndex = 0;
    this.currentSegment.clear();
    this.pausedData = {};
  }

  async pause(): Promise<void> {
    if (this.state !== RecorderState.Recording) {
      throw new Error(`Cannot pause recording in ${this.state} state`);
    }
    
    await this.flushSegment();
    this.pausedData.lastTick = Array.from(this.currentSegment.keys()).pop();
    this.state = RecorderState.Paused;
  }

  async resume(): Promise<void> {
    if (this.state !== RecorderState.Paused) {
      throw new Error(`Cannot resume recording in ${this.state} state`);
    }
    
    this.state = RecorderState.Recording;
  }

  async record(tick: number, data: T): Promise<void> {
    if (this.state !== RecorderState.Recording) {
      throw new Error(`Cannot record in ${this.state} state`);
    }

    // 检查tick顺序
    if (this.pausedData.lastTick !== undefined && tick <= this.pausedData.lastTick) {
      throw new Error(`Invalid tick sequence: ${tick} <= ${this.pausedData.lastTick}`);
    }

    this.currentSegment.set(tick, data);

    if (this.currentSegment.size >= this.segmentSize) {
      await this.flushSegment();
    }
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
    if (this.state === RecorderState.Idle) {
      throw new Error("Cannot stop recording when not started");
    }

    await this.flushSegment();

    const meta: ReplayMeta = JSON.parse(
      await fs.readFile(path.join(this.dataDir, HEADER_NAME), "utf-8")
    );

    meta.totalTicks = this.segmentIndex * this.segmentSize + this.currentSegment.size;
    await fs.writeFile(
      path.join(this.dataDir, HEADER_NAME),
      JSON.stringify(meta)
    );

    this.state = RecorderState.Idle;
    return meta;
  }

  async discard(): Promise<void> {
    this.stop();
    await fs.rm(this.dataDir, { recursive: true, force: true });
  }
}