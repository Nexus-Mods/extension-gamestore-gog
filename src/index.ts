import * as Promise from 'bluebird';

import * as path from 'path';
import * as winapi from 'winapi-bindings';

// import { GameEntryNotFound, IExecInfo,
//   IGameStore, IGameStoreEntry } from '../types/api';

import { log, types, util } from 'vortex-api';

const STORE_ID = 'gog';

const GOG_EXEC = 'GalaxyClient.exe';

const REG_GOG_GAMES = 'SOFTWARE\\WOW6432Node\\GOG.com\\Games';

/**
 * base class to interact with local GoG Galaxy client
 * @class GoGLauncher
 */
class GoGLauncher implements types.IGameStore {
  public id: string;
  private mClientPath: Promise<string>;
  private mCache: Promise<types.IGameStoreEntry[]>;

  constructor() {
    this.id = STORE_ID;
    if (process.platform === 'win32') {
      // No Windows, no gog launcher!
      try {
        const gogPath = winapi.RegGetValue('HKEY_LOCAL_MACHINE',
          'SOFTWARE\\WOW6432Node\\GOG.com\\GalaxyClient\\paths', 'client');
        this.mClientPath = Promise.resolve(gogPath.value as string);
      } catch (err) {
        log('info', 'gog not found', { error: err.message });
        this.mClientPath = Promise.resolve(undefined);
      }
    } else {
      log('info', 'gog not found', { error: 'only available on Windows systems' });
    }
  }

  /**
   * find the first game that matches the specified name pattern
   */
  public findByName(namePattern: string): Promise<types.IGameStoreEntry> {
    const re = new RegExp(namePattern);
    return this.allGames()
      .then(entries => entries.find(entry => re.test(entry.name)))
      .then(entry => {
        if (entry === undefined) {
          return Promise.reject(new types.GameEntryNotFound(namePattern, STORE_ID));
        } else {
          return Promise.resolve(entry);
        }
      });
  }

  public launchGame(appInfo: any, api?: types.IExtensionApi): Promise<void> {
    return this.getExecInfo(appInfo)
      .then(execInfo =>
        api.runExecutable(execInfo.execPath, execInfo.arguments, {
          cwd: path.dirname(execInfo.execPath),
          suggestDeploy: true,
          shell: true,
      }));
  }

  public getExecInfo(appId: string): Promise<types.IExecInfo> {
    return this.allGames()
      .then(entries => {
        const gameEntry = entries.find(entry => entry.appid === appId);
        return (gameEntry === undefined)
          ? Promise.reject(new types.GameEntryNotFound(appId, STORE_ID))
          : this.mClientPath.then((basePath) => {
              const gogClientExec = {
                execPath: path.join(basePath, GOG_EXEC),
                arguments: ['/command=runGame',
                            `/gameId=${gameEntry.appid}`,
                            `path="${gameEntry.gamePath}"`],
              };

              return Promise.resolve(gogClientExec);
            });
      });
  }

  /**
   * find the first game with the specified appid or one of the specified appids
   */
  public findByAppId(appId: string): Promise<types.IGameStoreEntry> {
    return this.allGames()
      .then(entries => {
        const gameEntry = entries.find(entry => entry.appid === appId);
        if (gameEntry === undefined) {
          return Promise.reject(
            new types.GameEntryNotFound(Array.isArray(appId) ? appId.join(', ') : appId, STORE_ID));
        } else {
          return Promise.resolve(gameEntry);
        }
      });
  }

  public allGames(): Promise<types.IGameStoreEntry[]> {
    if (!this.mCache) {
      this.mCache = this.getGameEntries();
    }
    return this.mCache;
  }

  private getGameEntries(): Promise<types.IGameStoreEntry[]> {
    return new Promise<types.IGameStoreEntry[]>((resolve, reject) => {
      try {
        winapi.WithRegOpen('HKEY_LOCAL_MACHINE', REG_GOG_GAMES, hkey => {
          const keys = winapi.RegEnumKeys(hkey);
          const gameEntries: types.IGameStoreEntry[] = keys.map(key => {
            try {
              const gameEntry: types.IGameStoreEntry = {
                appid: winapi.RegGetValue(hkey, key.key, 'gameID').value as string,
                gamePath: winapi.RegGetValue(hkey, key.key, 'path').value as string,
                name: winapi.RegGetValue(hkey, key.key, 'startMenu').value as string,
                gameStoreId: STORE_ID,
              };
              return gameEntry;
            } catch (err) {
              log('error', 'gamestore-gog: failed to create game entry', err);
              // Don't stop, keep going.
              return undefined;
            }
          }).filter(entry => !!entry);
          return resolve(gameEntries);
        });
      } catch (err) {
        return reject(err);
      }
    });
  }
}

function main(context: types.IExtensionContext) {
  const instance: types.IGameStore =
    process.platform === 'win32' ? new GoGLauncher() : undefined;

  if (instance !== undefined) {
    context.registerGameStore(instance);
  }

  return true;
}

export default main;
