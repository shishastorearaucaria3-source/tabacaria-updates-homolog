const https = require('node:https');
const fs = require('node:fs');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { join } = require('node:path');

const NODE_VERSION = '22.14.0';
const NODE_ZIP_URL = `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`;
const NODE_ZIP_SHA256 = '55b639295920b219bb2acbcfa00f90393a2789095b7323f79475c9f34795f217';
const DEST_DIR = join(process.cwd(), 'build', 'autoupdate');
const DEST_FILE = join(DEST_DIR, 'node.exe');

function downloadWithProgress(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}: ${url}`));
        return;
      }
      const total = parseInt(response.headers['content-length'] || '0', 10);
      let downloaded = 0;
      response.on('data', (chunk) => {
        downloaded += chunk.length;
        if (total > 0) {
          const pct = ((downloaded / total) * 100).toFixed(1);
          process.stdout.write(`\r[download] ${pct}% (${(downloaded/1024/1024).toFixed(1)}/${(total/1024/1024).toFixed(1)} MB)`);
        }
      });
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
    }).on('error', reject);
  });
}

function verifySha256(filePath, expected) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => {
      const actual = hash.digest('hex').toLowerCase();
      if (actual === expected.toLowerCase()) {
        console.log(`\n[verify] SHA-256 OK: ${actual}`);
        resolve(true);
      } else {
        reject(new Error(`SHA-256 mismatch!\n  expected: ${expected}\n  actual:   ${actual}`));
      }
    });
    stream.on('error', reject);
  });
}

function extractNodeExe(zipPath, destFile) {
  return new Promise((resolve, reject) => {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    const nodeEntry = entries.find(e => e.entryName.endsWith('node.exe'));
    if (!nodeEntry) {
      reject(new Error('node.exe not found in zip'));
      return;
    }
    const content = zip.readFile(nodeEntry);
    fs.writeFileSync(destFile, content);
    console.log(`\n[extract] Extracted ${nodeEntry.entryName} (${content.length} bytes)`);
    resolve();
  });
}

async function main() {
  console.log(`[download] Node.js v${NODE_VERSION} standalone for win-x64`);
  console.log(`[download] URL: ${NODE_ZIP_URL}`);
  console.log(`[download] Dest: ${DEST_FILE}`);

  if (!fs.existsSync(DEST_DIR)) {
    fs.mkdirSync(DEST_DIR, { recursive: true });
  }

  if (fs.existsSync(DEST_FILE)) {
    console.log('[download] node.exe already exists, verifying zip...');
  }

  const zipPath = join(DEST_DIR, `node-v${NODE_VERSION}-win-x64.zip`);

  try {
    await downloadWithProgress(NODE_ZIP_URL, zipPath);
    console.log('\n[download] Download complete, verifying SHA-256...');
    await verifySha256(zipPath, NODE_ZIP_SHA256);
    console.log('[extract] Extracting node.exe from zip...');
    await extractNodeExe(zipPath, DEST_FILE);
    fs.unlinkSync(zipPath);
    console.log('[download] Success!');
  } catch (e) {
    console.error('[download] FAILED:', e.message);
    process.exit(1);
  }
}

main();