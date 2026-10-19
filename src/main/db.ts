import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import initSqlJs, { type Database } from 'sql.js'

export interface PersistentDatabase {
  db: Database
  save(): void
}

/** Opens (or creates) a SQLite file. sql.js keeps the database in memory; `save` writes it atomically. */
export async function openDatabase(file: string): Promise<PersistentDatabase> {
  const SQL = await initSqlJs({ locateFile: (f) => join(dirname(require.resolve('sql.js')), f) })
  const db = existsSync(file) ? new SQL.Database(readFileSync(file)) : new SQL.Database()
  return {
    db,
    save() {
      mkdirSync(dirname(file), { recursive: true })
      const tmp = `${file}.tmp`
      writeFileSync(tmp, db.export())
      renameSync(tmp, file)
    }
  }
}
