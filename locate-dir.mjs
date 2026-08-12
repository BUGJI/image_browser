import { app } from 'electron'
import { join, relative } from 'path'
import { Worker } from 'node:worker_threads'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'

const rootDir = r'D:\Users\BUGJI\Pictures\冰与火之舞素材'

app.whenReady().then(async () => {
  const dir = join(rootDir, '旧版', '冰与火素材', '矢量素材')
  // 通过 Python 拿真实路径
  const { execSync } = await import('child_process')
  const py = execSync('python -c "import sys;print(sys.argv[1])"', { encoding: 'utf8' }).trim()
  console.log('py check:', py)
  app.exit(0)
})
