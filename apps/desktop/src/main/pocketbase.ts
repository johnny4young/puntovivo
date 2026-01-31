import { spawn, ChildProcess } from 'child_process';
import { app } from 'electron';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { get } from 'http';

/**
 * PocketBase Manager
 * Manages the embedded PocketBase backend as a child process
 */
export class PocketBaseManager {
  private process: ChildProcess | null = null;
  private port = 8090;
  private host = '127.0.0.1';
  private isRunning = false;

  /**
   * Start the PocketBase server
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('PocketBase is already running');
      return;
    }

    const pbPath = this.getPocketBasePath();
    const dataDir = this.getDataDirectory();

    // Ensure data directory exists
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    console.log(`Starting PocketBase from: ${pbPath}`);
    console.log(`Data directory: ${dataDir}`);

    try {
      this.process = spawn(
        pbPath,
        ['serve', '--http', `${this.host}:${this.port}`, '--dir', dataDir],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: false,
        }
      );

      this.process.stdout?.on('data', data => {
        console.log(`[PocketBase] ${data}`);
      });

      this.process.stderr?.on('data', data => {
        console.error(`[PocketBase Error] ${data}`);
      });

      this.process.on('error', error => {
        console.error('Failed to start PocketBase:', error);
        this.isRunning = false;
      });

      this.process.on('exit', (code, signal) => {
        console.log(`PocketBase exited with code ${code} and signal ${signal}`);
        this.isRunning = false;
        this.process = null;
      });

      // Wait for PocketBase to be ready
      await this.waitForReady();
      this.isRunning = true;
      console.log(`PocketBase started successfully at ${this.getUrl()}`);
    } catch (error) {
      console.error('Error starting PocketBase:', error);
      throw error;
    }
  }

  /**
   * Stop the PocketBase server gracefully
   */
  async stop(): Promise<void> {
    if (!this.process || !this.isRunning) {
      return;
    }

    return new Promise(resolve => {
      if (this.process) {
        this.process.once('exit', () => {
          this.process = null;
          this.isRunning = false;
          console.log('PocketBase stopped');
          resolve();
        });

        // Try graceful shutdown first
        this.process.kill('SIGTERM');

        // Force kill after 5 seconds if still running
        setTimeout(() => {
          if (this.process) {
            console.log('Force killing PocketBase...');
            this.process.kill('SIGKILL');
          }
        }, 5000);
      } else {
        resolve();
      }
    });
  }

  /**
   * Get the PocketBase API URL
   */
  getUrl(): string {
    return `http://${this.host}:${this.port}`;
  }

  /**
   * Check if PocketBase is running
   */
  isServerRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get the path to the PocketBase binary based on platform
   */
  private getPocketBasePath(): string {
    const platform = process.platform;
    const arch = process.arch;

    // Map Node.js platform/arch to PocketBase naming
    const platformMap: Record<string, string> = {
      darwin: 'darwin',
      linux: 'linux',
      win32: 'windows',
    };

    const archMap: Record<string, string> = {
      x64: 'amd64',
      arm64: 'arm64',
    };

    const pbPlatform = platformMap[platform] || platform;
    const pbArch = archMap[arch] || arch;

    const binaryName = platform === 'win32' ? 'pocketbase.exe' : 'pocketbase';
    const binaryPath = path.join(
      this.getResourcesPath(),
      'pocketbase',
      `${pbPlatform}_${pbArch}`,
      binaryName
    );

    // In development, try local path
    if (!app.isPackaged) {
      const devPath = path.join(
        __dirname,
        '../../resources/pocketbase',
        `${pbPlatform}_${pbArch}`,
        binaryName
      );
      if (existsSync(devPath)) {
        return devPath;
      }
    }

    return binaryPath;
  }

  /**
   * Get the resources path (different in dev vs production)
   */
  private getResourcesPath(): string {
    if (app.isPackaged) {
      return process.resourcesPath;
    }
    // In development, use the app directory
    return path.join(__dirname, '../../resources');
  }

  /**
   * Get the data directory for PocketBase
   */
  private getDataDirectory(): string {
    return path.join(app.getPath('userData'), 'pb_data');
  }

  /**
   * Wait for PocketBase to be ready (health check)
   */
  private async waitForReady(maxAttempts = 30, intervalMs = 500): Promise<void> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (await this.healthCheck()) {
        return;
      }
      await this.sleep(intervalMs);
    }
    throw new Error('PocketBase failed to start within the expected time');
  }

  /**
   * Perform a health check on PocketBase
   */
  private healthCheck(): Promise<boolean> {
    return new Promise(resolve => {
      const request = get(`${this.getUrl()}/api/health`, res => {
        resolve(res.statusCode === 200);
      });

      request.on('error', () => {
        resolve(false);
      });

      request.setTimeout(1000, () => {
        request.destroy();
        resolve(false);
      });
    });
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
export const pocketbaseManager = new PocketBaseManager();
