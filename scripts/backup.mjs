import { closeSync, openSync, rmSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'
import { databasePath } from '../lib/server/database.ts'

let database
let created
try {
  if (process.argv.length !== 3) throw new Error('Provide a destination for the new database backup.')
  const source = databasePath()
  const destination = resolve(process.argv[2])
  if (destination === source || statSync(source).size === 0) throw new Error('Backup requires an existing source and a new destination.')
  closeSync(openSync(destination, 'wx', 0o600))
  created = destination
  database = new DatabaseSync(source, { readOnly: true })
  database.exec('PRAGMA busy_timeout = 5000')
  await backup(database, destination)
  console.log('Monitor database backup complete.')
} catch {
  if (created) rmSync(created, { force: true })
  console.error('Backup failed. Check the source database and supply a new backup path in an existing directory.')
  process.exitCode = 1
} finally {
  database?.close()
}
