import { performance } from 'perf_hooks';
import { promises as fs } from 'fs';
import { pack } from 'msgpackr';
import path from 'path';
import { TickData, ReplayConfig, PlayerAction } from './types';

export class Recorder {
  private segmentSize: number;
  private currentSegment: TickData[] = [];
  private segmentIndex = 0;
  private dataDir: string;
  private isRecording = false;
  private isPaused = false;
  private startTime = 0;
  private currentTick = 0;
  private debug: boolean;

  constructor(dataDir: string, config: ReplayConfig = {}) {
    this.dataDir = dataDir;
    this.segmentSize = config.segmentSize || 1000;
    this.debug = config.debug ?? true;
  }

  start(): void {
    this.isRecording = true;
    this.startTime = performance.now();
    this.currentTick = 0;
    this.log('录制开始');
  }

  addInput(playerId: number, action: PlayerAction): void {
    if (!this.isRecording || this.isPaused) return;
    const currentTime = performance.now() - this.startTime;
    const tick = Math.floor(currentTime / (1000 / 30)); // 计算当前Tick

    // 确保时间轴连续
    while (this.currentTick <= tick) {
      this.currentSegment.push({
        tick: this.currentTick,
        time: this.currentTick * (1000 / 30),
        inputs: this.currentTick === tick ? [{ playerId, action }] : []
      });
      this.currentTick++;
    }

    if (this.currentSegment.length >= this.segmentSize) {
      this.saveCurrentSegment();
    }
  }

  private async saveCurrentSegment(): Promise<void> {
    const segmentPath = path.join(this.dataDir, `segment_${this.segmentIndex}.dat`);
    await fs.writeFile(segmentPath, pack(this.currentSegment));
    this.segmentIndex++;
    this.currentSegment = [];
  }

  async stop(): Promise<void> {
    if (this.currentSegment.length > 0) {
      await this.saveCurrentSegment();
    }
    this.isRecording = false;
    this.log('录制停止');
  }

  private log(...args: unknown[]) {
    if (this.debug) console.log('[Recorder]', ...args);
  }
}