import { app } from 'electron'
import { Worker } from 'node:worker_threads'
import { join } from 'path'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { PNG } from 'pngjs'

app.whenReady().then(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thumbtest-'))
  const srcDir = join(dir, '相册')
  const { mkdirSync } = await import('fs')
  mkdirSync(srcDir, { recursive: true })

  const png = new PNG({ width: 64, height: 64 })
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const idx = (png.width * y + x) << 2
      png.data[idx] = x * 4
      png.data[idx + 1] = y * 4
      png.data[idx + 2] = 100
      png.data[idx + 3] = 255
    }
  const abs = join(srcDir, 'pic.png')
  writeFileSync(abs, PNG.sync.write(png))

  const worker = new Worker(join(process.cwd(), 'src', 'main', 'cache-worker.mjs'))
  worker.on('error', (e) => {
    console.log('WORKER ERROR:', e.message)
    app.exit(1)
  })
  worker.on('message', (m) => {
    if (m.type === 'thumb-done') {
      console.log('thumb-done OK, relThumb =', m.relThumb, 'size =', m.width + 'x' + m.height)
      console.log('SUCCESS: worker thumb generation works')
      app.exit(0)
    } else if (m.type === 'thumb-fail') {
      console.log('thumb-fail for', m.name)
      app.exit(2)
    } else if (m.type === 'error') {
      console.log('WORKER MSG ERROR:', m.message)
      app.exit(3)
    }
  })
  worker.postMessage({
    type: 'thumb',
    jobs: [{ id: 1, absPath: abs, relPath: '相册/pic.png', name: 'pic.png' }],
    thumbDir: join(dir, 'out'),
    thumbWidth: 512,
    thumbQuality: 80
  })
})
