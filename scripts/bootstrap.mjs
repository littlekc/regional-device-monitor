import { Readable } from 'node:stream'
import { MonitorAuth } from '../lib/server/auth.ts'
import { readText } from '../lib/server/body.ts'
import { MonitorDatabase } from '../lib/server/database.ts'
import { MonitorError } from '../lib/server/errors.ts'

let database
try {
  if (process.argv.length !== 2) throw new Error('Administrator password must be supplied via stdin or environment.')
  const password = process.env.MONITOR_ADMIN_PASSWORD
    ?? (await readText(Readable.toWeb(process.stdin), 1024)).replace(/\r?\n$/, '')
  database = new MonitorDatabase()
  await new MonitorAuth(database).bootstrap(password)
  console.log('Monitor administrator initialized.')
} catch (error) {
  console.error(error instanceof MonitorError ? error.message : 'Monitor administrator initialization failed.')
  process.exitCode = 1
} finally {
  database?.close()
}
