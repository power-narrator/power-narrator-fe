import { app } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function resolveScriptPath(scriptName: string): string {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'electron', 'scripts', scriptName);
    } else {
        // From electron/platform/helpers.ts to electron/scripts/
        return path.join(__dirname, '../scripts', scriptName);
    }
}
