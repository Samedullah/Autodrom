#!/usr/bin/env node
// Optimizes car and map .glb files for Autodrom without breaking animated
// wheel, steering-pivot, caliper, or brake/reverse lamp hierarchies, and
// keeps public/assets/models/manifest.json synced with existing car GLBs.
//
// Usage:
//   npm run check-models                  # Inspects all .glb files (size, Meshopt, WebP)
//   npm run optimize-models               # Optimizes unoptimized .glb files & syncs manifest
//   npm run optimize-models -- --force    # Re-optimizes every .glb file
//   npm run optimize-models -- path.glb   # Optimizes specific file(s) or folder(s)

import { existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const MODELS_ROOT = join(ROOT, 'public/assets/models');
const MANIFEST_PATH = join(MODELS_ROOT, 'manifest.json');
const DATA_TS_PATH = join(ROOT, 'src/data.ts');

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const positional = args.filter((a) => !a.startsWith('--'));

const checkOnly = flags.has('--check') || flags.has('--dry-run');
const force = flags.has('--force');
const carTexSize = readNumericFlag(args, '--car-tex-size', 1024);
const mapTexSize = readNumericFlag(args, '--map-tex-size', 2048);

function readNumericFlag(argv, name, fallback) {
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  if (eq) {
    const n = Number(eq.slice(name.length + 1));
    if (Number.isFinite(n) && n >= 128) return Math.round(n);
  }
  const idx = argv.indexOf(name);
  if (idx >= 0 && argv[idx + 1]) {
    const n = Number(argv[idx + 1]);
    if (Number.isFinite(n) && n >= 128) return Math.round(n);
  }
  return fallback;
}

function collectGlbFiles(targetPath, into = []) {
  if (!existsSync(targetPath)) return into;
  const st = statSync(targetPath);
  if (st.isFile()) {
    if (extname(targetPath).toLowerCase() === '.glb') into.push(resolve(targetPath));
    return into;
  }
  if (st.isDirectory()) {
    for (const entry of readdirSync(targetPath).sort()) {
      collectGlbFiles(join(targetPath, entry), into);
    }
  }
  return into;
}

function inspectGlb(filePath) {
  const buf = readFileSync(filePath);
  const sizeBytes = buf.byteLength;
  if (sizeBytes < 20 || buf.readUInt32LE(0) !== 0x46546c67) {
    return { valid: false, sizeBytes, hasMeshopt: false, hasWebp: false, images: 0, nonWebpImages: 0 };
  }
  const jsonLen = buf.readUInt32LE(12);
  const jsonType = buf.readUInt32LE(16);
  if (jsonType !== 0x4e4f534a || 20 + jsonLen > sizeBytes) {
    return { valid: false, sizeBytes, hasMeshopt: false, hasWebp: false, images: 0, nonWebpImages: 0 };
  }
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const ext = new Set([...(gltf.extensionsUsed ?? []), ...(gltf.extensionsRequired ?? [])]);
  const images = gltf.images ?? [];
  const nonWebpImages = images.filter((img) => img.mimeType && img.mimeType !== 'image/webp').length;
  const isMap = filePath.includes(`${join('models', 'MAP')}`);
  const sizeLimitBytes = isMap ? 12 * 1024 * 1024 : 2.2 * 1024 * 1024;
  const hasMeshopt = ext.has('EXT_meshopt_compression');
  const hasWebp = images.length === 0 || (ext.has('EXT_texture_webp') && nonWebpImages === 0);
  const needsOptimization = !hasMeshopt || !hasWebp || sizeBytes > sizeLimitBytes;
  return {
    valid: true,
    sizeBytes,
    isMap,
    hasMeshopt,
    hasWebp,
    images: images.length,
    nonWebpImages,
    needsOptimization,
  };
}

function formatMb(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function resolveGltfTransformRunner() {
  const localBin = join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'gltf-transform.cmd' : 'gltf-transform');
  if (existsSync(localBin)) return { cmd: localBin, prefixArgs: [] };
  const globalCheck = spawnSync('gltf-transform', ['--version'], { stdio: 'ignore' });
  if (globalCheck.status === 0) return { cmd: 'gltf-transform', prefixArgs: [] };
  return { cmd: 'npx', prefixArgs: ['--yes', '@gltf-transform/cli@4'] };
}

function syncManifest() {
  if (!existsSync(DATA_TS_PATH)) return 0;
  const src = readFileSync(DATA_TS_PATH, 'utf8');
  const entryRegex = /id:\s*'([^']+)'[\s\S]*?modelPath:\s*'([^']+)'/g;
  const available = [];
  const seen = new Set();
  let match;
  while ((match = entryRegex.exec(src)) !== null) {
    const [, id, modelPath] = match;
    if (seen.has(id)) continue;
    const diskPath = join(ROOT, 'public', modelPath.replace(/^\//, ''));
    if (existsSync(diskPath)) {
      seen.add(id);
      available.push(id);
    }
  }
  if (available.length > 0) {
    writeFileSync(MANIFEST_PATH, JSON.stringify({ models: available }, null, 2) + '\n', 'utf8');
  }
  return available.length;
}

const targets = positional
  .filter((p) => !/^\d+$/.test(p))
  .flatMap((p) => collectGlbFiles(p));
const files = targets.length > 0 ? targets : collectGlbFiles(MODELS_ROOT);

if (files.length === 0) {
  console.log('Optimize edilecek .glb dosyası bulunamadı.');
  process.exit(0);
}

const report = files.map((file) => ({ file, rel: relative(ROOT, file), info: inspectGlb(file) }));
const candidates = report.filter((r) => r.info.valid && (force || r.info.needsOptimization));
const totalBytesBefore = report.reduce((sum, r) => sum + r.info.sizeBytes, 0);

console.log(`\nAutodrom GLB Model Analizi (${report.length} dosya, toplam ${formatMb(totalBytesBefore)})`);
console.log('─'.repeat(86));
for (const r of report) {
  const { info } = r;
  const status = !info.valid
    ? 'GEÇERSİZ'
    : !info.needsOptimization
      ? 'OPTİMİZE'
      : 'OPTİMİZE EDİLEBİLİR';
  const tags = [
    info.hasMeshopt ? 'meshopt:✓' : 'meshopt:✗',
    info.hasWebp ? 'webp:✓' : `webp:✗(${info.nonWebpImages}/${info.images})`,
  ].join(' ');
  console.log(`${status.padEnd(20)} ${formatMb(info.sizeBytes).padStart(9)}  ${tags.padEnd(24)} ${r.rel}`);
}
console.log('─'.repeat(86));

if (checkOnly) {
  console.log(`Özet: ${candidates.length} / ${report.length} model daha da küçültülebilir.`);
  console.log('Uygulamak için: npm run optimize-models\n');
  process.exit(0);
}

if (candidates.length === 0) {
  const synced = syncManifest();
  console.log(`Tüm modeller zaten optimize durumda. manifest.json güncellendi (${synced} araç).\n`);
  process.exit(0);
}

const runner = resolveGltfTransformRunner();
const scratchDir = mkdtempSync(join(tmpdir(), 'autodrom-glb-'));
let savedBytes = 0;
let optimizedCount = 0;

try {
  for (const item of candidates) {
    const texSize = item.info.isMap ? mapTexSize : carTexSize;
    const tempOut = join(scratchDir, basename(item.file));
    console.log(`→ İşleniyor (${texSize}px WebP + Meshopt): ${item.rel} ...`);

    // CRITICAL: --flatten false --join false --simplify false preserves every wheel,
    // steering pivot, brake caliper, and rear/reverse lamp node name for vehicle.ts!
    const cliArgs = [
      ...runner.prefixArgs,
      'optimize',
      item.file,
      tempOut,
      '--compress', 'meshopt',
      '--texture-compress', 'webp',
      '--texture-size', String(texSize),
      '--flatten', 'false',
      '--join', 'false',
      '--instance', 'false',
      '--palette', 'false',
      '--simplify', 'false',
      '--weld', 'false',
    ];

    const res = spawnSync(runner.cmd, cliArgs, { stdio: 'inherit' });
    if (res.status !== 0 || !existsSync(tempOut)) {
      console.warn(`  ! Atlandı (komut hata döndürdü): ${item.rel}`);
      continue;
    }

    const afterSize = statSync(tempOut).size;
    if (!force && afterSize >= item.info.sizeBytes && item.info.hasMeshopt && item.info.hasWebp) {
      rmSync(tempOut, { force: true });
      console.log(`  ✓ Zaten en küçük boyutta (${formatMb(item.info.sizeBytes)}), korundu.`);
      continue;
    }

    const targetTmp = join(dirname(item.file), `.${basename(item.file)}.opt-tmp`);
    writeFileSync(targetTmp, readFileSync(tempOut));
    renameSync(targetTmp, item.file);
    rmSync(tempOut, { force: true });

    const delta = item.info.sizeBytes - afterSize;
    savedBytes += Math.max(0, delta);
    optimizedCount += 1;
    console.log(`  ✓ ${formatMb(item.info.sizeBytes)} → ${formatMb(afterSize)} (${delta >= 0 ? '-' + formatMb(delta) : '+' + formatMb(-delta)})`);
  }
} finally {
  rmSync(scratchDir, { recursive: true, force: true });
}

const syncedCount = syncManifest();
console.log('─'.repeat(86));
console.log(`Tamamlandı: ${optimizedCount} model optimize edildi, toplam ${formatMb(savedBytes)} kazanç sağlandı.`);
console.log(`manifest.json senkronize edildi (${syncedCount} araç aktif).\n`);
