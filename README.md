# Dynamic Workspace Extension

[![Licence](https://img.shields.io/github/license/betwo/vscode-dynamic-workspace-extension.svg)](https://github.com/betwo/vscode-dynamic-workspace-extension)
[![VS Code Marketplace](https://vsmarketplacebadges.dev/version-short/betwo.vscode-dynamic-workspace-extension.svg) ![Rating](https://vsmarketplacebadges.dev/rating-short/betwo.vscode-dynamic-workspace-extension.svg) ![Downloads](https://vsmarketplacebadges.dev/downloads-short/betwo.vscode-dynamic-workspace-extension.svg) ![Installs](https://vsmarketplacebadges.dev/installs-short/betwo.vscode-dynamic-workspace-extension.svg)](https://marketplace.visualstudio.com/items?itemName=betwo.vscode-dynamic-workspace-extension)

This extension allows users to develop workspace specific vscode integration without creating a fully new extension.

To achieve this, the extension dynamically loads typescript code from the opened workspace folders and runs them in the extension context.

This allows users of this extension to implement *workspace-specific* IDE extensions, which might especially be helpful when working with mono repositories.

**There are some caveats, though. Please consider the remarks below before using this**


## Security Warning

**Please only use this extension if you trust all authors of your workspaces.**

As this extensions executes workspace code on startup of vs code, untrusted code might be malicious.
We only execute any plugins in a workspace if the user has set that workspace to **trusted**.

## How does the extension work?

This extension loads plugins, written in typescript, directly from the opened workspace folders and runs them in the extension context.

### Plugins

When activated, the extension uses the `base_directories` setting to identify plugins in all opened workspace that are marked as trusted:
```json
 "dynamic_workspace_extension.base_directories": [
    "path/inside/workspace",
    "another/path/inside/maybe/a/different/workspace",
  ]
```
If any of these paths exist and contain a `package.json` file, the plugin is activated.

Plugin themselves are structured similarly to [VS Code extensions](https://code.visualstudio.com/api/references/vscode-api), see the example below.


### Activation

When this extension gets [activated](https://code.visualstudio.com/api/references/vscode-api#Extension.activate), it forwards the extension context to all plugins.

Plugins are automatically re-activated when their source code changes. This can also be triggered manually with the `extension.dynamic_workspace_extension.reload_plugins` command.


## When (not) to use

This extension is meant to only be used for implementing IDE functionality that is **specific to only you workspace**.

There are many limitations when using this extension, due to the fact that plugins are not fully fledged extensions.

**Please consider createing an actual VS Code extension if that is possible for you.**


## Example usage:

This example demonstrates how to work with this extension. It simply displays a warning message in vs code when activated.

Let `<plugin-path>` be a path in your workspace.

Create the following files:
  * `<plugin-path>/src/plugin.ts`
  * `<plugin-path>/package.json`
  * `<plugin-path>/tsconfig.json`

Then add `<plugin-path>` to the base paths by adding
```json
 "dynamic_workspace_extension.base_directories": [
    <plugin-path>,
  ]
```
to your workspace settings.

### src/plugin.ts

This file is the main entry point.

```typescript
import * as vscode from 'vscode';

// This is called whenever the plugin is (re)activated
export async function activate(ctx: vscode.ExtensionContext) {
    vscode.window.showWarningMessage(`Example plugin activated`);
}

// This is called when the workspace is closed or when the plugin is reloaded
export function deactivate(ctx: vscode.ExtensionContext) {
    vscode.window.showWarningMessage(`Example plugin deactivated`);
}
```

### package.json

```json
{
  "name": "workspace-bootstrap",
  "displayName": "Repository Bootstrapper Package",
  "description": "Show an alert when loaded.",
  "version": "1.0.0",
  "engines": {
    "vscode": "^1.56.0"
  },
  "main": "./out/plugin.js",
  "activationEvents": [
    "*"
  ],
  "scripts": {
    "compile": "tsc -p .",
    "postinstall": "node ./node_modules/vscode/bin/install"
  },
  "dependencies": {
    "@types/node": "^10",
    "vscode": "^1.1.37"
  },
  "devDependencies": {
    "@types/vscode": "^1.57.0",
    "typescript": "^4.3.4"
  }
}

```

### tsconfig.json

```json
{
	"compilerOptions": {
		"module": "commonjs",
		"target": "es6",
		"outDir": "out",
		"moduleResolution": "Node",
		"lib": [
			"es2015"
		],
		"sourceMap": true,
		"rootDir": "src",
		"skipLibCheck": true,
		"typeRoots": [
			"node_modules/@types"
		]
	},
	"exclude": [
		"node_modules"
	]
}
```

### Licenses:

<div>Icons made by <a href="https://www.freepik.com" title="Freepik">Freepik</a> from <a href="https://www.flaticon.com/" title="Flaticon">www.flaticon.com</a></div>