
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {

	console.log('Congratulations, your extension "project-hot-map" is now active!');
	const disposable = vscode.commands.registerCommand('project-hot-map.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from project-hot-map!');
	});

	context.subscriptions.push(disposable);
}

export function deactivate() {}
