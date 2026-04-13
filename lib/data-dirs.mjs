import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PERSIST_DIR = '/var/data';
const LOCAL_DATA_DIR = path.join(__dirname, '..', 'data');

export const DATA_DIR = fs.existsSync(PERSIST_DIR) ? PERSIST_DIR : LOCAL_DATA_DIR;
export const ERP_FILE = path.join(DATA_DIR, 'maintenance.json');
