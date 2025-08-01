import { promises as fs } from 'fs';
import { pack } from 'msgpackr';
import path from 'path';
import { TickData } from './types';

export class SegmentedRecorder {
  private segmentSize: number;
  private currentSegment: TickData[] = [];
  private segmentIndex = 0;
  private dataDir: string;
  private totalTicks = 0;

  constructor(dataDir: string, segmentSize = 1000) {
    this.dataDir = dataDir;
    this.segmentSize = segmentSize;
  }

  async addTick(tickData: TickData): Promise<void> {
    this.currentSegment.push(tickData);
    this.totalTicks++;

    if (this.currentSegment.length >= this.segmentSize) {
      await this.saveCurrentSegment();
      this.segmentIndex++;
      this.currentSegment = [];
    }
  }

  private async saveCurrentSegment(): Promise<void> {
    const segmentPath = path.join(this.dataDir, `segment_${this.segmentIndex}.dat`);
    await fs.writeFile(segmentPath, pack(this.currentSegment));
  }

  async finalize(players: number[]): Promise<void> {
    if (this.currentSegment.length > 0) {
      await this.saveCurrentSegment();
    }

    const header = {
      totalTicks: this.totalTicks,
      segmentSize: this.segmentSize,
      players,
      createdAt: new Date().toISOString()
    };
    await fs.writeFile(
      path.join(this.dataDir, 'header.json'),
      JSON.stringify(header, null, 2)
    );
  }
}