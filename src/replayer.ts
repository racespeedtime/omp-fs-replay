import { performance } from 'perf_hooks';
import { promises as fs } from 'fs';
import { unpack } from 'msgpackr';
import path from 'path';
import { TickData, ProcessInputsFn, ApplyStateFn, ReplayConfig } from './types';

const TICK_INTERVAL_MS = 1000 / 30;

export class Replayer {
  private segmentSize: number;
  private totalTicks: number = 0;
  private loadedSegments = new Map<number, TickData[]>();
  private dataDir: string;
  private currentTick = 0;
  private isPlaying = false;
  private isPaused = false;
  private playbackSpeed = 1.0;
  private startTime = 0;
  private timer: NodeJS.Timeout | null = null;
  private debug: boolean;
  private processInputs: ProcessInputsFn;
  private applyState: ApplyStateFn;
  private currentState: PlayerState[] = [];

  constructor(
    dataDir: string,
    processInputs: ProcessInputsFn,
    applyState: ApplyStateFn,
    config: ReplayConfig = {}
  ) {
    this.dataDir = dataDir;
    this.processInputs = processInputs;
    this.applyState = applyState;
    this.segmentSize = config.segmentSize || 1000;
    this.debug = config.debug ?? true;
  }

  async init(initialState: PlayerState[]): Promise<void> {
    const header = JSON.parse(
      await fs.readFile(path.join(this.dataDir, 'header.json'), 'utf-8')
    );
    this.totalTicks = header.totalTicks;
    this.currentState = initialState;
    this.log('回放初始化完成');
  }

  private async loadSegment(segmentIndex: number): Promise<void> {
    if (this.loadedSegments.has(segmentIndex)) return;
    const segmentPath = path.join(this.dataDir, `segment_${segmentIndex}.dat`);
    const segment = unpack(await fs.readFile(segmentPath)) as TickData[];
    this.loadedSegments.set(segmentIndex, segment);
    this.log(`加载段 ${segmentIndex}`);
  }

  private getFrame(tick: number): TickData | null {
    const segmentIndex = Math.floor(tick / this.segmentSize);
    const segment = this.loadedSegments.get(segmentIndex);
    return segment?.[tick % this.segmentSize] ?? null;
  }

  async play(): Promise<void> {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.isPaused = false;
    this.startTime = performance.now() - (this.currentTick * TICK_INTERVAL_MS / this.playbackSpeed);
    this.log('开始播放');
    await this.processTick();
  }

  private async processTick(): Promise<void> {
    if (!this.isPlaying || this.isPaused) return;

    const frame = this.getFrame(this.currentTick);
    if (!frame) {
      this.log('回放结束');
      return;
    }

    // 正常播放时处理输入
    if (frame.inputs.length > 0) {
      this.currentState = this.processInputs(frame.inputs, this.currentState);
    }

    this.applyState(this.currentState);
    this.currentTick++;

    // 下一帧
    const nextFrame = this.getFrame(this.currentTick);
    if (!nextFrame) {
      this.log('回放结束');
      return;
    }

    const delay = (nextFrame.time - frame.time) / this.playbackSpeed;
    this.timer = setTimeout(() => this.processTick(), delay);
  }

  async seekToTick(tick: number): Promise<boolean> {
    if (tick < 0 || tick >= this.totalTicks) {
      this.log(`非法跳转: Tick ${tick} 超出范围`);
      return false;
    }

    // 跳转时直接计算目标状态（不处理中间输入）
    const segmentIndex = Math.floor(tick / this.segmentSize);
    await this.loadSegment(segmentIndex);

    // 重置状态到初始值，然后重新处理所有输入直到目标Tick
    let state = [...this.initialState];
    for (let i = 0; i <= tick; i++) {
      const frame = this.getFrame(i);
      if (frame?.inputs.length > 0) {
        state = this.processInputs(frame.inputs, state);
      }
    }

    this.currentState = state;
    this.currentTick = tick;
    this.applyState(state);
    this.log(`跳转到 Tick ${tick}`);
    return true;
  }

  private log(...args: any[]) {
    if (this.debug) console.log('[Replayer]', ...args);
  }
}