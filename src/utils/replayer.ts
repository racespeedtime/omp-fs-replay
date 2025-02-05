import * as fs from 'fs';
import * as path from 'path';
import { createInterface } from 'readline';

// 定义事件接口
interface Event {
    action: string;
    direction?: string; // 可选字段
    timestamp: number;
    playerId: string; // 添加玩家ID字段以便过滤
}

class PlayerReplayer {
    private directory: string;
    private isPaused: boolean = false;
    private pauseResolve: ((value: any) => void) | null = null;

    /**
     * 构造函数
     * @param directory 日志文件所在的目录路径
     */
    constructor(directory: string) {
        this.directory = directory;
    }

    /**
     * 回放事件
     * @param callback 处理每个事件的回调函数
     * @param options 过滤选项，包括startTime、endTime和playerId
     * @param progressCallback 进度报告回调函数
     */
    public async replayEvents(
        callback: (event: Event) => void,
        options?: { startTime?: number, endTime?: number, playerId?: string },
        progressCallback?: (progress: { currentFile: string, totalFiles: number, processedEvents: number }) => void
    ): Promise<void> {
        try {
            const files = fs.readdirSync(this.directory).filter(file => file.endsWith('.jsonl')).sort();
            let processedEvents = 0;

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                await this.processFile(path.join(this.directory, file), async (event) => {
                    while (this.isPaused) {
                        await new Promise<void>((resolve) => {
                            this.pauseResolve = resolve;
                        });
                    }
                    callback(event);
                    processedEvents++;
                    if (progressCallback) {
                        progressCallback({ currentFile: file, totalFiles: files.length, processedEvents });
                    }
                }, options);
            }
        } catch (err) {
            console.error('Error reading directory:', err);
        }
    }

    /**
     * 按批处理文件，支持并发读取
     * @param filePath 文件路径
     * @param callback 处理每个事件的回调函数
     * @param options 过滤选项
     */
    private async processFile(
        filePath: string,
        callback: (event: Event) => void,
        options?: { startTime?: number, endTime?: number, playerId?: string }
    ): Promise<void> {
        const fileStream = fs.createReadStream(filePath);
        const rl = createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });

        let lastTimestamp = 0;

        for await (const line of rl) {
            try {
                const event: Event = JSON.parse(line);

                // 根据过滤条件跳过不符合要求的事件
                if (options) {
                    if (options.startTime && event.timestamp < options.startTime) continue;
                    if (options.endTime && event.timestamp > options.endTime) continue;
                    if (options.playerId && event.playerId !== options.playerId) continue;
                }

                // 计算延迟时间并等待
                if (lastTimestamp !== 0) {
                    const delay = event.timestamp - lastTimestamp;
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
                callback(event);
                lastTimestamp = event.timestamp;
            } catch (err) {
                console.error(`Error parsing line in file ${filePath}:`, err);
                continue; // 跳过当前行，继续处理下一行
            }
        }

        // 错误处理
        fileStream.on('error', (err) => {
            console.error(`Error reading file ${filePath}:`, err);
        });

        // 文件处理完成时的日志
        rl.on('close', () => {
            console.log(`Finished processing file ${filePath}`);
        });
    }

    /**
     * 暂停回放
     */
    public pause(): void {
        this.isPaused = true;
    }

    /**
     * 恢复回放
     */
    public resume(): void {
        this.isPaused = false;
        if (this.pauseResolve) {
            this.pauseResolve(null);
            this.pauseResolve = null;
        }
    }
}

// 使用示例
const replayer = new PlayerReplayer(path.join(__dirname, 'logs'));

replayer.replayEvents(
    (event) => {
        console.log(`Replaying action: ${event.action} at ${event.timestamp}`);
        if (event.direction) {
            console.log(`Direction: ${event.direction}`);
        }
    },
    { startTime: Date.now() - 1000 * 60 * 60, endTime: Date.now(), playerId: 'player1' }, // 示例过滤条件
    (progress) => {
        console.log(`Processing file ${progress.currentFile}, ${progress.processedEvents} events processed`);
    }
);

// 模拟暂停和恢复
setTimeout(() => {
    console.log('Pausing...');
    replayer.pause();
}, 5000);

setTimeout(() => {
    console.log('Resuming...');
    replayer.resume();
}, 10000);