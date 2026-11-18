#!/usr/bin/env node
/**
 * Download all Amharic NASV Audio Bible files from GitHub releases
 * Run with: node scripts/download-audio.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://github.com/kalelbethel-kalkord/bible-app-assets/releases/download';
const RELEASES = [
  { tag: 'audio-v1', dir: 'audio' },
  { tag: 'audio-v1-patch', dir: 'audio' },
];

const DEST_DIR = path.join(__dirname, '../assets/audio');
const MAX_CONCURRENT = 8;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function downloadFile(url, dest, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 10) {
      reject(new Error(`Too many redirects for ${url}`));
      return;
    }
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        const redirectUrl = response.headers.location;
        if (!redirectUrl) {
          reject(new Error(`Redirect without location header for ${url}`));
          return;
        }
        file.close();
        fs.unlink(dest, () => {});
        downloadFile(redirectUrl, dest, redirectCount + 1).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download ${url}: ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(dest);
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function fetchAssets(tag) {
  return new Promise((resolve, reject) => {
    https.get(`https://api.github.com/repos/kalelbethel-kalkord/bible-app-assets/releases/tags/${tag}`, {
      headers: { 'User-Agent': 'birhan-audio-downloader' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const release = JSON.parse(data);
          const assets = release.assets
            .filter(a => a.name.endsWith('.mp3'))
            .map(a => ({
              name: a.name,
              url: a.browser_download_url,
              size: a.size,
              sha256: a.digest.replace('sha256:', '')
            }));
          resolve(assets);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function downloadWithLimit(assets, tag, concurrency = MAX_CONCURRENT) {
  const queue = [...assets];
  const running = new Set();
  let completed = 0;
  let failed = 0;

  const processNext = async () => {
    if (queue.length === 0 && running.size === 0) return;
    
    while (running.size < concurrency && queue.length > 0) {
      const asset = queue.shift();
      const dest = path.join(DEST_DIR, asset.name);
      
      // Skip if already exists and size matches
      if (fs.existsSync(dest)) {
        const stats = fs.statSync(dest);
        if (stats.size === asset.size) {
          console.log(`✓ Skipping ${asset.name} (already downloaded)`);
          completed++;
          continue;
        }
      }

      const promise = downloadFile(asset.url, dest)
        .then(() => {
          console.log(`✓ Downloaded ${asset.name} (${(asset.size/1024/1024).toFixed(2)} MB)`);
          completed++;
        })
        .catch(err => {
          console.error(`✗ Failed ${asset.name}: ${err.message}`);
          failed++;
        })
        .finally(() => {
          running.delete(promise);
          processNext();
        });

      running.add(promise);
    }
  };

  await processNext();
  
  // Wait for all running downloads
  while (running.size > 0) {
    await Promise.race(running);
  }

  return { completed, failed };
}

async function main() {
  ensureDir(DEST_DIR);
  console.log(`Downloading to ${DEST_DIR}\n`);

  for (const release of RELEASES) {
    console.log(`\n=== Fetching ${release.tag} ===`);
    const assets = await fetchAssets(release.tag);
    console.log(`Found ${assets.length} MP3 files`);
    
    const result = await downloadWithLimit(assets, release.tag);
    console.log(`\n${release.tag}: ${result.completed} completed, ${result.failed} failed`);
  }

  // Generate manifest
  const allFiles = fs.readdirSync(DEST_DIR).filter(f => f.endsWith('.mp3'));
  const manifest = allFiles.map(f => {
    const stats = fs.statSync(path.join(DEST_DIR, f));
    return { name: f, size: stats.size };
  });
  
  fs.writeFileSync(
    path.join(DEST_DIR, 'manifest.json'),
    JSON.stringify({ files: manifest, total: manifest.length, totalSize: manifest.reduce((a, b) => a + b.size, 0) }, null, 2)
  );
  
  console.log(`\n=== Done ===`);
  console.log(`Total files: ${manifest.length}`);
  console.log(`Total size: ${(manifest.reduce((a, b) => a + b.size, 0) / 1024 / 1024 / 1024).toFixed(2)} GB`);
  console.log(`Manifest written to ${path.join(DEST_DIR, 'manifest.json')}`);
}

main().catch(console.error);