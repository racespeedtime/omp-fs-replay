import { promises as fs } from "fs";
import path from "path";
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

  constructor(dataDir: string, config: ReplayConfig = {}) {
    this.dataDir = dataDir;
    this.segmentSize = config.segmentSize || SEGMENT_SIZE;
    this.tickRate = config.tickRate || TICK_MS;
  }

  async start(): Promise<void> {
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
  }

  async record(tick: number, data: T): Promise<void> {
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
    await this.flushSegment();

    const meta: ReplayMeta = JSON.parse(
      await fs.readFile(path.join(this.dataDir, HEADER_NAME), "utf-8")
    );

    meta.totalTicks = this.segmentIndex * this.segmentSize;
    await fs.writeFile(
      path.join(this.dataDir, HEADER_NAME),
      JSON.stringify(meta)
    );

    return meta;
  }
}
