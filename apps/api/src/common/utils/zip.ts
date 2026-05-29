import { createWriteStream, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

export async function createZipBuffer(
  rootDir: string,
  files: Array<{ path: string; content: string }>,
): Promise<Buffer> {
  const { default: archiver } = await import('archiver');
  return new Promise((resolve, reject) => {
    const tmpFile = join(tmpdir(), `project-${randomUUID()}.zip`);
    const output = createWriteStream(tmpFile);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      const buf = readFileSync(tmpFile);
      unlinkSync(tmpFile);
      resolve(buf);
    });
    archive.on('error', (err) => reject(err));

    archive.pipe(output);

    for (const file of files) {
      archive.append(file.content, { name: join(rootDir, file.path) });
    }

    archive.finalize();
  });
}
