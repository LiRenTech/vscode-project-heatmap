
import * as vscode from 'vscode';
import { ProjectHeatmapPanel } from './heatmapPanel';

export function activate(context: vscode.ExtensionContext) {
	const disposable = vscode.commands.registerCommand('project-heatmap.showHeatmap', () => {
		ProjectHeatmapPanel.show(context.extensionUri);
	});

	context.subscriptions.push(disposable);
}

export function deactivate() {}
