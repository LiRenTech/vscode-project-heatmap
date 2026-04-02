
import * as vscode from 'vscode';
import { ProjectHotMapPanel } from './hotMapPanel';

export function activate(context: vscode.ExtensionContext) {
	const disposable = vscode.commands.registerCommand('project-hot-map.showHeatMap', () => {
		ProjectHotMapPanel.show();
	});

	context.subscriptions.push(disposable);
}

export function deactivate() {}
