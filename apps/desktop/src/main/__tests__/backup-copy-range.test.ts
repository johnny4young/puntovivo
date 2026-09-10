import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import {
  BACKUP_COPY_BUFFER_BYTES,
  copyBackupFileRange,
  type BackupRangeReader,
  type BackupRangeWriter,
} from '../backup/backup-bundle/copy-range.ts';

describe('bounded backup range copy', () => {
  for (const shortIO of [false, true]) {
    it(`copies exactly one range with a single buffer and ${shortIO ? 'partial' : 'full'} I/O`, async () => {
      const offset = 23,
        length = BACKUP_COPY_BUFFER_BYTES * 3 + 71;
      const input = Buffer.from(Array.from({ length: offset + length + 47 }, (_, i) => i % 251));
      const output = Buffer.alloc(length),
        readBuffers = new Set<Buffer>();
      let readCount = 0,
        writtenCount = 0,
        verified = 0,
        writing = false;
      const source: BackupRangeReader = {
        async read(buffer, bufferOffset, requested, position) {
          assert.equal(writing, false, 'a pending write still owns the buffer');
          assert.equal(buffer.byteLength, BACKUP_COPY_BUFFER_BYTES);
          readBuffers.add(buffer);
          readCount += 1;
          assert.ok(position >= offset && position + requested <= offset + length);
          const bytesRead = Math.min(requested, shortIO ? 33_333 : requested);
          input.copy(buffer, bufferOffset, position, position + bytesRead);
          return { bytesRead };
        },
      };
      const destination: BackupRangeWriter = {
        async write(buffer, bufferOffset, requested, position) {
          assert.equal(writing, false);
          writing = true;
          const original = Buffer.from(buffer.subarray(bufferOffset, bufferOffset + requested));
          await yieldTurn();
          assert.deepEqual(buffer.subarray(bufferOffset, bufferOffset + requested), original);
          const bytesWritten = Math.min(requested, shortIO ? 7_777 : requested);
          buffer.copy(output, position, bufferOffset, bufferOffset + bytesWritten);
          writtenCount += 1;
          writing = false;
          return { bytesWritten };
        },
      };
      await copyBackupFileRange({
        source,
        destination,
        sourceOffset: offset,
        byteLength: length,
        verifyChunk(chunk) {
          verified += chunk.length;
        },
      });
      assert.deepEqual(output, input.subarray(offset, offset + length));
      assert.equal(verified, length);
      assert.equal(readBuffers.size, 1);
      assert.ok(readCount > 3 && writtenCount >= readCount);
    });
  }

  const forbiddenIO = {
    async read(): Promise<{ bytesRead: number }> {
      throw new Error('unexpected read');
    },
    async write(): Promise<{ bytesWritten: number }> {
      throw new Error('unexpected write');
    },
  };
  it('does not allocate or touch files for an empty range', async () => {
    await copyBackupFileRange({
      source: forbiddenIO,
      destination: forbiddenIO,
      sourceOffset: 7,
      byteLength: 0,
      verifyChunk: () => assert.fail('unexpected verification'),
    });
  });
  for (const [sourceOffset, byteLength] of [
    [-1, 1],
    [0, -1],
    [NaN, 1],
    [0, Infinity],
    [1.5, 1],
    [0, 1.5],
    [Number.MAX_SAFE_INTEGER, 1],
  ] as const) {
    it(`rejects unsafe range ${sourceOffset}/${byteLength} before I/O`, async () => {
      await assert.rejects(
        copyBackupFileRange({
          source: forbiddenIO,
          destination: forbiddenIO,
          sourceOffset,
          byteLength,
          verifyChunk() {},
        }),
        RangeError
      );
    });
  }
  for (const count of [0, -1, NaN, 1.5, 5]) {
    it(`rejects invalid read progress ${count}`, async () => {
      await assert.rejects(
        copyBackupFileRange({
          source: {
            async read() {
              return { bytesRead: count };
            },
          },
          destination: forbiddenIO,
          sourceOffset: 0,
          byteLength: 4,
          verifyChunk() {
            assert.fail('invalid bytes');
          },
        }),
        /truncated|invalid read/
      );
    });
    it(`rejects invalid write progress ${count}`, async () => {
      await assert.rejects(
        copyBackupFileRange({
          source: {
            async read(buffer) {
              buffer.fill(1);
              return { bytesRead: 4 };
            },
          },
          destination: {
            async write() {
              return { bytesWritten: count };
            },
          },
          sourceOffset: 0,
          byteLength: 4,
          verifyChunk() {},
        }),
        /write did not make valid progress/
      );
    });
  }
  it('never writes bytes rejected by the integrity verifier', async () => {
    await assert.rejects(
      copyBackupFileRange({
        source: {
          async read(buffer) {
            buffer.fill(1);
            return { bytesRead: 4 };
          },
        },
        destination: forbiddenIO,
        sourceOffset: 0,
        byteLength: 4,
        verifyChunk() {
          throw new Error('CRC or size rejected');
        },
      }),
      /CRC or size rejected/
    );
  });
  it('propagates an I/O failure without retrying or reading another chunk', async () => {
    let reads = 0;
    await assert.rejects(
      copyBackupFileRange({
        source: {
          async read(buffer) {
            reads += 1;
            buffer.fill(1);
            return { bytesRead: 4 };
          },
        },
        destination: {
          async write() {
            throw new Error('disk full');
          },
        },
        sourceOffset: 0,
        byteLength: 8,
        verifyChunk() {},
      }),
      /disk full/
    );
    assert.equal(reads, 1);
  });
});
