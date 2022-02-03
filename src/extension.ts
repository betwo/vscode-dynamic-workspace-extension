import * as vscode from 'vscode';
import * as fs from 'fs';
import * as process from 'process';
import * as child_process from 'child_process';
import { basename, dirname } from 'path';

declare const __non_webpack_require__: NodeRequire;

let compile_output_provider: vscode.TextDocumentContentProvider;
let last_error_log: ShellOutput;
let workspace_plugins = new Map<vscode.WorkspaceFolder, Map<fs.PathLike, Plugin>>();

class ShellOutput {
  constructor(
    public stdout: string,
    public stderr: string,
    public command: string,
    public error?: Error
  ) {
  }
}

export async function activate(context: vscode.ExtensionContext) {
  if (!vscode.workspace.isTrusted) {
    vscode.window.showErrorMessage("Refusing to enable dynamic extensions due to untrusted workspace");
    return;
  }

  await ensureCommandWorks('tsc', ['-h'], "tsc_path");
  await ensureCommandWorks('npm', ["help"], "npm_path");

  compile_output_provider = new class implements vscode.TextDocumentContentProvider {

    onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    onDidChange = this.onDidChangeEmitter.event;

    provideTextDocumentContent(uri: vscode.Uri): string {
      if (last_error_log === undefined) {
        return "Unknown error (no log)";
      }
      console.error("!!", last_error_log);

      return `
Command failed: ${last_error_log.command}

Error: ${last_error_log.error}

stdout:
${last_error_log.stdout}

stderr:
${last_error_log.stderr}`;
    }
  };

  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('dwe', compile_output_provider));
  context.subscriptions.push(vscode.commands.registerCommand(
    'extension.dynamic_workspace_extension.reload_plugins', async () => {
      return reloadPlugins();
    }));

  vscode.workspace.onDidChangeWorkspaceFolders(workspaces => {
    for (const workspace of workspaces.removed) {
      unregisterWorkspace(workspace);
    }
    for (const workspace of workspaces.added) {
      registerWorkspace(workspace);
    }
  });

  console.log(vscode.workspace.workspaceFolders);
  if (vscode.workspace.workspaceFolders !== undefined) {
    for (let root of vscode.workspace.workspaceFolders) {
      await registerWorkspace(root);
    }
  }
}
export function deactivate() { }


class Plugin {
  public vscode_context: vscode.ExtensionContext;
  public code: any;

  private watcher: any;
  private reload_requested = false;

  public constructor(public plugin_dir: fs.PathLike, public plugin_src: fs.PathLike) { }

  public async load() {
    this.watcher = vscode.workspace.createFileSystemWatcher(`${this.plugin_dir}/**/*.ts`);
    this.watcher.onDidChange(e => {
      console.log(e);
      this.reloadLater();
    });

    if (await this.compile()) {
      this.activate();
    }
  }

  private async compile(): Promise<boolean> {
    try {
      last_error_log = undefined;
      const tsc_binary = vscode.workspace.getConfiguration('dynamic_workspace_extension').get("tsc_path", "tsc");
      await runCommand(tsc_binary, ["-p", "."], [], this.plugin_dir);
      return true;

    } catch (error) {
      console.error(error);
      last_error_log = error;
      const message = `Failed to compile ${this.plugin_dir}`;
      vscode.window.showErrorMessage(message);
      const hook = basename(this.plugin_dir.toString());
      const uri = vscode.Uri.parse('dwe:' + `${hook} failed to compile`);
      const doc = await vscode.workspace.openTextDocument(uri);

      vscode.window.showTextDocument(doc, { preview: false });
      return false;
    }
  }

  public async activate() {
    this.vscode_context = <vscode.ExtensionContext>{
      subscriptions: []
    };
    this.code = __non_webpack_require__(this.plugin_src.toString());
    this.code.activate(this.vscode_context);
  }

  public async deactivate() {
    if (this.code !== undefined) {
      await this.code.deactivate(this.vscode_context);
      for (let sub of this.vscode_context.subscriptions) {
        sub.dispose();
      }
      console.log(__non_webpack_require__);
      const prefix = dirname(this.plugin_src.toString());
      for (let index in __non_webpack_require__.cache) {
        const cached_pkg = __non_webpack_require__.cache[index];
        if (cached_pkg.path.startsWith(prefix.toString())) {
          delete __non_webpack_require__.cache[index];
        }
      }
      console.log(__non_webpack_require__);
    }
  }

  public async reload() {
    if (await this.compile()) {
      await this.deactivate();
      await this.activate();
    }
  }

  private async reloadLater() {
    if (!this.reload_requested) {
      this.reload_requested = true;
      setTimeout(e => {
        if (this.reload_requested) {
          this.reload_requested = false;
          this.reload();
        }
      }, 1000);
    }
  }
}

async function runCommand(command: string, args: string[], environment: [string, string][], cwd?: fs.PathLike, callback?: (process: child_process.ChildProcess) => any): Promise<ShellOutput> {
  let environment_kv = {};
  for (let v of environment) {
    environment_kv[v['name']] = v['value'];
  }
  let options: child_process.ExecOptions = {
    cwd: cwd !== undefined ? cwd.toString() : undefined,
    maxBuffer: 1024 * 1024,
    env: environment.length === 0 ? process.env : environment_kv
  };
  let full_command = `${command} ${args.join(" ")}`;
  return await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Running command ${full_command}`,
    cancellable: false
  }, async (progress, token) => {
    return new Promise<ShellOutput>((resolve, reject) => {
      let process = child_process.execFile(command, args, options, (error, stdout, stderr) => {
        if (stdout) {
          console.log(stdout);
        }
        if (stderr) {
          console.error(stderr);
        }
        const result = new ShellOutput(stdout, stderr, full_command);
        if (error) {
          result.error = error;
          reject(result);
        } else {
          resolve(result);
        }
      });
      if (callback) {
        callback(process);
      }
    });
  });
}


async function registerWorkspace(root: vscode.WorkspaceFolder) {
  if (!workspace_plugins.has(root)) {
    workspace_plugins.set(root, new Map<fs.PathLike, Plugin>());
  }
  let plugins = workspace_plugins.get(root);

  const directories = vscode.workspace.getConfiguration('dynamic_workspace_extension').get("base_directories", []);
  for (const directory of directories) {
    const absolute_directory = `${root.uri.fsPath}/${directory}`;
    if (!fs.existsSync(`${absolute_directory}/package.json`)) {
      console.log(`Directory '${directory}' does not exist in workspace ${root.uri.fsPath.toString()}`);
      continue;
    }

    const npm_binary = vscode.workspace.getConfiguration('dynamic_workspace_extension').get("npm_path", "npm");
    try {
      console.log(`Loading code from ${directory}`);
      const node_modules = `${absolute_directory}/node_modules`;
      console.log(node_modules);
      if (!fs.existsSync(node_modules)) {
        const abort = {
          title: "abort"
        };
        const initialize = {
          title: "Run 'npm install'"
        };
        const result = await vscode.window.showErrorMessage(`No node_modules directory found. Tried ${node_modules}`, {}, abort, initialize);
        if (result === abort) {
          return;
        } else if (result === initialize) {
          await runCommand(npm_binary, ["install", "--production=false"], [], `${root.uri.fsPath}/${directory}`);
        }
      }

      const plugin_dir = `${root.uri.fsPath}/${directory}`;
      const plugin_src = `${plugin_dir}/out/plugin.js`;

      let plugin = new Plugin(plugin_dir, plugin_src);
      plugins.set(directory, plugin);
      plugin.load();

    } catch (e) {
      console.error(e);
      vscode.window.showErrorMessage(`Failed to load vscode hook ${directory}`);
    }
  }

}

async function unregisterWorkspace(root: vscode.WorkspaceFolder) {
  const directories = vscode.workspace.getConfiguration('dynamic_workspace_extension').get("base_directories", []);
  if (workspace_plugins.has(root)) {
    let plugins = workspace_plugins.get(root);
    for (const directory of directories) {
      if (plugins.has(directory)) {
        let plugin = plugins.get(directory);
        plugin.deactivate();
        plugins.delete(directory);
      }
    }
    if (plugins.size === 0) {
      workspace_plugins.delete(root);
    }
  }
}

async function reloadPlugins() {
  if (vscode.workspace.workspaceFolders !== undefined) {
    for (let root of vscode.workspace.workspaceFolders) {
      await unregisterWorkspace(root);
    }
    for (let root of vscode.workspace.workspaceFolders) {
      await registerWorkspace(root);
    }
  }
}

async function selectBinary(name: string): Promise<fs.PathLike> {
  const commands: fs.PathLike[] = [];
  for (const path of process.env['PATH'].split(":")) {
    const binary_path = `${path}/${name}`;
    console.log(binary_path);
    if (fs.existsSync(binary_path)) {
      commands.push(binary_path);
    }
  }

  if (commands.length === 0) {
    vscode.window.showErrorMessage(`Could not find the '${name}' exectuable`);
    return undefined;
  }

  if (commands.length === 1) {
    return commands[0];
  }

  const command_list = [];
  for (const binary_path of commands) {
    command_list.push(<vscode.QuickPickItem>{
      label: binary_path,
      description: binary_path
    });
  }
  const selection = await vscode.window.showQuickPick(command_list);
  if (selection !== undefined) {
    return selection.label;
  } else {
    return undefined;
  }
}

async function ensureCommandWorks(binary_name: string, args: string[], setting: string): Promise<boolean> {
  const binary = vscode.workspace.getConfiguration('dynamic_workspace_extension').get(setting, binary_name);
  try {
    await runCommand(binary, args, []);
    return true;

  } catch (error) {
    const abort = {
      title: "abort"
    };
    const initialize = {
      title: `find ${binary_name} in system`
    };
    const result = await vscode.window.showErrorMessage(`Command ${binary_name} is not available.`, {}, abort, initialize);
    if (result === abort) {
      return false;

    } else if (result === initialize) {
      const binary_path = await selectBinary(binary_name);
      if (binary_path === undefined) {
        return false;
      }

      let config = vscode.workspace.getConfiguration('dynamic_workspace_extension');
      config.update(setting, binary_path, vscode.ConfigurationTarget.Workspace);
      return ensureCommandWorks(binary_name, args, setting);
    }
    return false;
  }
}
