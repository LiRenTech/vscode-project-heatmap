import * as vscode from 'vscode';
import { collectHeatmapData } from './projectScanner';

export class ProjectHeatmapPanel {
	private static currentPanel: ProjectHeatmapPanel | undefined;

	public static show(extensionUri: vscode.Uri) {
		if (ProjectHeatmapPanel.currentPanel) {
			ProjectHeatmapPanel.currentPanel.panel.reveal(vscode.ViewColumn.Active);
			return;
		}

		const panel = vscode.window.createWebviewPanel(
			'projectHeatmap',
			'项目文件热力图',
			vscode.ViewColumn.Active,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
			},
		);

		ProjectHeatmapPanel.currentPanel = new ProjectHeatmapPanel(panel, extensionUri);
	}

	private readonly panel: vscode.WebviewPanel;
	private readonly disposables: vscode.Disposable[] = [];

	private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
		this.panel = panel;
		this.panel.iconPath = {
			light: vscode.Uri.joinPath(extensionUri, 'media', 'flame-light.svg'),
			dark: vscode.Uri.joinPath(extensionUri, 'media', 'flame-dark.svg'),
		};
		this.panel.webview.html = this.getHtml(this.panel.webview);

		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
		this.panel.webview.onDidReceiveMessage((message) => {
			void this.handleMessage(message);
		}, null, this.disposables);
	}

	private async handleMessage(message: unknown) {
		if (!isObject(message) || typeof message.type !== 'string') {
			return;
		}

		switch (message.type) {
			case 'ready':
			case 'refresh':
				await this.refresh();
				return;
			case 'open-file':
				if (typeof message.uri !== 'string') {
					return;
				}
				await this.openFile(message.uri);
				return;
			default:
				return;
		}
	}

	private async refresh() {
		await this.panel.webview.postMessage({ type: 'loading' });

		try {
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders || workspaceFolders.length === 0) {
				throw new Error('请先在 VS Code 中打开一个项目文件夹。');
			}
			const payload = await collectHeatmapData(workspaceFolders);
			await this.panel.webview.postMessage({ type: 'data', payload });
		} catch (error) {
			const message = error instanceof Error ? error.message : '生成热力图失败。';
			await this.panel.webview.postMessage({ type: 'error', message });
		}
	}

	private async openFile(uriText: string) {
		try {
			const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(uriText));
			await vscode.window.showTextDocument(document, {
				preview: false,
				viewColumn: vscode.ViewColumn.Active,
				preserveFocus: false,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : '打开文件失败。';
			void vscode.window.showErrorMessage(message);
		}
	}

	private getHtml(webview: vscode.Webview): string {
		const nonce = createNonce();

		return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>项目文件热力图</title>
	<style>
		:root {
			color-scheme: dark;
			font-family: var(--vscode-font-family);
		}

		body {
			margin: 0;
			background: #0d0b11;
			color: var(--vscode-foreground);
		}

		.shell {
			display: grid;
			grid-template-rows: auto auto 1fr;
			height: 100vh;
		}

		.toolbar {
			display: flex;
			justify-content: space-between;
			align-items: center;
			gap: 12px;
			padding: 14px 18px 10px;
			border-bottom: 1px solid rgba(255, 255, 255, 0.06);
			background: linear-gradient(180deg, rgba(34, 20, 46, 0.9) 0%, rgba(13, 11, 17, 0.95) 100%);
		}

		.title {
			font-size: 16px;
			font-weight: 700;
		}

		.subtitle {
			font-size: 12px;
			opacity: 0.72;
			margin-top: 4px;
		}

		.actions {
			display: flex;
			align-items: center;
			gap: 12px;
		}

		.color-control {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 8px 10px;
			border-radius: 10px;
			border: 1px solid rgba(255, 255, 255, 0.08);
			background: rgba(7, 7, 9, 0.42);
		}

		.color-control label {
			font-size: 12px;
			opacity: 0.82;
			white-space: nowrap;
		}

		.color-control input[type="range"] {
			width: 140px;
			accent-color: #ff9923;
		}

		.color-control .hint {
			font-size: 12px;
			opacity: 0.72;
			white-space: nowrap;
		}

		button {
			border: 1px solid rgba(255, 255, 255, 0.1);
			border-radius: 8px;
			padding: 8px 14px;
			color: #fff1d6;
			background: linear-gradient(90deg, #1e102d 0%, #4f1516 50%, #d36b1f 100%);
			cursor: pointer;
			font: inherit;
		}

		button:hover {
			filter: brightness(1.08);
		}

		.legend {
			display: grid;
			grid-template-columns: 1fr auto auto;
			align-items: center;
			gap: 12px;
			padding: 10px 18px 12px;
			border-bottom: 1px solid rgba(255, 255, 255, 0.06);
			background: rgba(0, 0, 0, 0.18);
		}

		.legend-bar {
			height: 12px;
			border-radius: 999px;
			background: linear-gradient(90deg, #040404 0%, #1a0726 18%, #45101f 36%, #8f141a 56%, #de4313 76%, #ff9923 90%, #ffe35e 100%);
			box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
		}

		.legend-label {
			font-size: 12px;
			opacity: 0.72;
			white-space: nowrap;
		}

		.canvas-wrap {
			position: relative;
			min-height: 0;
		}

		canvas {
			display: block;
			width: 100%;
			height: 100%;
		}

		.status {
			position: absolute;
			left: 20px;
			top: 18px;
			z-index: 2;
			padding: 8px 12px;
			border-radius: 999px;
			background: rgba(7, 7, 9, 0.82);
			border: 1px solid rgba(255, 255, 255, 0.08);
			font-size: 12px;
			backdrop-filter: blur(6px);
		}

		.tooltip {
			position: absolute;
			pointer-events: none;
			opacity: 0;
			transform: translate(10px, 10px);
			max-width: min(340px, calc(100vw - 32px));
			padding: 10px 12px;
			border-radius: 10px;
			background: rgba(8, 7, 11, 0.95);
			border: 1px solid rgba(255, 255, 255, 0.1);
			box-shadow: 0 14px 36px rgba(0, 0, 0, 0.34);
			font-size: 12px;
			line-height: 1.5;
			z-index: 3;
		}

		.tooltip strong {
			display: block;
			font-size: 13px;
			color: #fff4d8;
		}
	</style>
</head>
<body>
	<div class="shell">
		<div class="toolbar">
			<div>
				<div class="title">项目文件热力图</div>
				<div id="summary" class="subtitle">准备读取项目文件与 Git 提交历史…</div>
			</div>
			<div class="actions">
				<div class="color-control">
					<label for="colorBias">色彩倾向</label>
					<span class="hint">冷</span>
					<input id="colorBias" type="range" min="0" max="100" step="1" value="50" />
					<span class="hint">热</span>
				</div>
				<button id="refresh" type="button">刷新热力图</button>
			</div>
		</div>
		<div class="legend">
			<div class="legend-bar"></div>
			<div class="legend-label">左侧较冷</div>
			<div class="legend-label">右侧更热</div>
		</div>
		<div class="canvas-wrap">
			<div id="status" class="status">正在分析项目…</div>
			<canvas id="heatmap"></canvas>
			<div id="tooltip" class="tooltip"></div>
		</div>
	</div>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const canvas = document.getElementById('heatmap');
		const tooltip = document.getElementById('tooltip');
		const summary = document.getElementById('summary');
		const statusNode = document.getElementById('status');
		const colorBiasRange = document.getElementById('colorBias');
		const refreshButton = document.getElementById('refresh');
		const canvasWrap = document.querySelector('.canvas-wrap');
		const context = canvas.getContext('2d');
		const state = {
			payload: null,
			hoveredUri: '',
			rects: [],
			status: 'loading',
			error: '',
			colorBias: 50,
		};
		const paletteStops = [
			{ stop: 0, color: '#040404' },
			{ stop: 0.18, color: '#1a0726' },
			{ stop: 0.36, color: '#45101f' },
			{ stop: 0.56, color: '#8f141a' },
			{ stop: 0.76, color: '#de4313' },
			{ stop: 0.9, color: '#ff9923' },
			{ stop: 1, color: '#ffe35e' },
		];
		const resizeObserver = new ResizeObserver(() => render());

		resizeObserver.observe(document.querySelector('.canvas-wrap'));
		restoreState();
		colorBiasRange.addEventListener('input', () => {
			const value = Number(colorBiasRange.value || 50);
			state.colorBias = clamp(0, 100, value);
			vscode.setState({ colorBias: state.colorBias });
			render();
		});
		refreshButton.addEventListener('click', () => {
			vscode.postMessage({ type: 'refresh' });
		});

		canvas.addEventListener('mousemove', (event) => {
			const rect = canvas.getBoundingClientRect();
			const x = event.clientX - rect.left;
			const y = event.clientY - rect.top;
			const hovered = state.rects.find((item) => pointInRect(x, y, item));
			if ((hovered?.uri || '') === state.hoveredUri) {
				updateTooltip(event.clientX, event.clientY);
				return;
			}
			state.hoveredUri = hovered?.uri || '';
			updateTooltip(event.clientX, event.clientY);
			render();
		});

		canvas.addEventListener('mouseleave', () => {
			state.hoveredUri = '';
			hideTooltip();
			render();
		});

		canvas.addEventListener('click', () => {
			const hovered = getHoveredRect();
			if (!hovered) {
				return;
			}
			vscode.postMessage({ type: 'open-file', uri: hovered.uri });
		});

		window.addEventListener('message', (event) => {
			const message = event.data;
			if (!message || typeof message.type !== 'string') {
				return;
			}
			if (message.type === 'loading') {
				state.status = 'loading';
				state.error = '';
				statusNode.textContent = '正在分析项目…';
				statusNode.style.display = 'block';
				return;
			}
			if (message.type === 'error') {
				state.status = 'error';
				state.error = typeof message.message === 'string' ? message.message : '生成热力图失败。';
				statusNode.textContent = state.error;
				statusNode.style.display = 'block';
				summary.textContent = '没有生成热力图数据。';
				state.payload = null;
				state.rects = [];
				render();
				return;
			}
			if (message.type === 'data') {
				state.status = 'ready';
				state.error = '';
				state.payload = normalizePayload(message.payload);
				statusNode.style.display = state.payload.items.length > 0 ? 'none' : 'block';
				statusNode.textContent = state.payload.items.length > 0 ? '' : '当前项目没有可显示的文件。';
				summary.textContent = buildSummary(state.payload);
				render();
			}
		});

		vscode.postMessage({ type: 'ready' });

		function normalizePayload(payload) {
			if (!payload || !Array.isArray(payload.items)) {
				return {
					items: [],
					fileCount: 0,
					maxCommitCount: 0,
					maxLineCount: 0,
					workspaceCount: 0,
					generatedAt: '',
				};
			}
			return {
				items: payload.items,
				fileCount: Number(payload.fileCount || 0),
				maxCommitCount: Number(payload.maxCommitCount || 0),
				maxLineCount: Number(payload.maxLineCount || 0),
				workspaceCount: Number(payload.workspaceCount || 0),
				generatedAt: String(payload.generatedAt || ''),
			};
		}

		function buildSummary(payload) {
			if (payload.items.length === 0) {
				return '当前项目没有可显示的文件。';
			}
			const mostActive = payload.items.reduce((current, item) => item.commitCount > current.commitCount ? item : current, payload.items[0]);
			return '共 ' + formatNumber(payload.fileCount) + ' 个文件，最大体积 ' + formatNumber(payload.maxLineCount) + ' 行，最高热度 ' + formatNumber(payload.maxCommitCount) + ' 次提交触达；当前最热文件：' + mostActive.displayPath;
		}

		function render() {
			const containerRect = canvas.getBoundingClientRect();
			const width = Math.max(320, Math.floor(containerRect.width));
			const height = Math.max(240, Math.floor(containerRect.height));
			const dpr = window.devicePixelRatio || 1;
			canvas.width = Math.floor(width * dpr);
			canvas.height = Math.floor(height * dpr);
			context.setTransform(dpr, 0, 0, dpr, 0, 0);
			context.clearRect(0, 0, width, height);

			drawBackground(width, height);

			if (!state.payload || state.payload.items.length === 0) {
				drawEmptyState(width, height);
				return;
			}

			const frame = {
				x: 16,
				y: 16,
				width: Math.max(40, width - 32),
				height: Math.max(40, height - 32),
			};
			const items = state.payload.items.map((item) => ({
				...item,
				weight: Math.max(item.lineCount, 1),
			}));
			const rects = layoutTreemap(items, frame);
			state.rects = rects;

			for (const rect of rects) {
				drawRect(rect, rect.uri === state.hoveredUri, state.payload.maxCommitCount);
			}
		}

		function drawBackground(width, height) {
			const gradient = context.createLinearGradient(0, 0, width, height);
			gradient.addColorStop(0, '#120d18');
			gradient.addColorStop(0.45, '#0b0911');
			gradient.addColorStop(1, '#07070a');
			context.fillStyle = gradient;
			context.fillRect(0, 0, width, height);
		}

		function drawEmptyState(width, height) {
			context.fillStyle = 'rgba(255, 255, 255, 0.75)';
			context.font = '600 14px var(--vscode-font-family)';
			context.textAlign = 'center';
			context.fillText(state.status === 'loading' ? '正在准备热力图…' : '当前没有可显示的数据。', width / 2, height / 2);
		}

		function drawRect(rect, hovered, maxCommitCount) {
			const fill = colorForHeat(maxCommitCount === 0 ? 0 : rect.commitCount / maxCommitCount);
			context.fillStyle = fill;
			context.fillRect(rect.x, rect.y, rect.width, rect.height);

			context.lineWidth = hovered ? 2 : 1;
			context.strokeStyle = hovered ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 255, 255, 0.08)';
			context.strokeRect(rect.x, rect.y, rect.width, rect.height);

			if (rect.width < 44 || rect.height < 24) {
				return;
			}

			const padding = 8;
			const title = baseName(rect.relativePath);
			const meta = rect.lineCount + ' 行 · ' + rect.commitCount + ' 次提交';
			context.save();
			context.beginPath();
			context.rect(rect.x + 1, rect.y + 1, Math.max(0, rect.width - 2), Math.max(0, rect.height - 2));
			context.clip();
			context.textAlign = 'left';
			context.fillStyle = rect.commitCount / Math.max(1, maxCommitCount) > 0.72 ? '#130805' : '#f7f0ea';
			context.font = '600 12px var(--vscode-font-family)';
			context.fillText(title, rect.x + padding, rect.y + 18, Math.max(0, rect.width - padding * 2));
			if (rect.height >= 42) {
				context.fillStyle = rect.commitCount / Math.max(1, maxCommitCount) > 0.72 ? 'rgba(19, 8, 5, 0.8)' : 'rgba(247, 240, 234, 0.82)';
				context.font = '11px var(--vscode-font-family)';
				context.fillText(meta, rect.x + padding, rect.y + 34, Math.max(0, rect.width - padding * 2));
			}
			context.restore();
		}

		function layoutTreemap(items, frame) {
			const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
			if (totalWeight <= 0) {
				return [];
			}
			const prepared = items
				.map((item) => ({
					...item,
					area: (item.weight / totalWeight) * frame.width * frame.height,
				}))
				.sort((left, right) => right.area - left.area);

			const rects = [];
			let row = [];
			let current = { ...frame };
			const remaining = prepared.slice();

			while (remaining.length > 0) {
				const candidate = remaining[0];
				const shortSide = Math.max(1, Math.min(current.width, current.height));
				if (row.length === 0 || worstRatio(row.concat(candidate), shortSide) <= worstRatio(row, shortSide)) {
					row.push(candidate);
					remaining.shift();
				} else {
					current = placeRow(row, current, rects);
					row = [];
				}
			}

			if (row.length > 0) {
				placeRow(row, current, rects);
			}

			return rects;
		}

		function worstRatio(row, shortSide) {
			if (row.length === 0) {
				return Number.POSITIVE_INFINITY;
			}
			const areas = row.map((item) => item.area);
			const sum = areas.reduce((total, value) => total + value, 0);
			const max = Math.max(...areas);
			const min = Math.min(...areas);
			const sideSquared = shortSide * shortSide;
			const sumSquared = sum * sum;
			return Math.max((sideSquared * max) / sumSquared, sumSquared / (sideSquared * Math.max(min, 1e-6)));
		}

		function placeRow(row, frame, rects) {
			const sum = row.reduce((total, item) => total + item.area, 0);
			if (frame.width >= frame.height) {
				const rowHeight = sum / Math.max(frame.width, 1e-6);
				let x = frame.x;
				for (let index = 0; index < row.length; index += 1) {
					const item = row[index];
					const width = index === row.length - 1 ? frame.x + frame.width - x : item.area / Math.max(rowHeight, 1e-6);
					rects.push({
						...item,
						x,
						y: frame.y,
						width: Math.max(0, width),
						height: Math.max(0, rowHeight),
					});
					x += width;
				}
				return {
					x: frame.x,
					y: frame.y + rowHeight,
					width: frame.width,
					height: Math.max(0, frame.height - rowHeight),
				};
			}

			const rowWidth = sum / Math.max(frame.height, 1e-6);
			let y = frame.y;
			for (let index = 0; index < row.length; index += 1) {
				const item = row[index];
				const height = index === row.length - 1 ? frame.y + frame.height - y : item.area / Math.max(rowWidth, 1e-6);
				rects.push({
					...item,
					x: frame.x,
					y,
					width: Math.max(0, rowWidth),
					height: Math.max(0, height),
				});
				y += height;
			}
			return {
				x: frame.x + rowWidth,
				y: frame.y,
				width: Math.max(0, frame.width - rowWidth),
				height: frame.height,
			};
		}

		function pointInRect(x, y, rect) {
			return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
		}

		function updateTooltip(clientX, clientY) {
			const hovered = getHoveredRect();
			if (!hovered) {
				hideTooltip();
				return;
			}
			if (!canvasWrap) {
				hideTooltip();
				return;
			}
			const wrapRect = canvasWrap.getBoundingClientRect();
			tooltip.innerHTML = '<strong>' + escapeHtml(hovered.displayPath) + '</strong>'
				+ '代码行数：' + formatNumber(hovered.lineCount) + '<br />'
				+ '提交触达：' + formatNumber(hovered.commitCount) + '<br />'
				+ '点击可在编辑器中打开文件';
			tooltip.style.opacity = '1';
			tooltip.style.left = clientX - wrapRect.left + 'px';
			tooltip.style.top = clientY - wrapRect.top + 'px';
		}

		function hideTooltip() {
			tooltip.style.opacity = '0';
		}

		function getHoveredRect() {
			return state.rects.find((item) => item.uri === state.hoveredUri) || null;
		}

		function colorForHeat(ratio) {
			ratio = applyColorBias(ratio);
			if (!Number.isFinite(ratio) || ratio <= 0) {
				return paletteStops[0].color;
			}
			if (ratio >= 1) {
				return paletteStops[paletteStops.length - 1].color;
			}
			for (let index = 1; index < paletteStops.length; index += 1) {
				const right = paletteStops[index];
				const left = paletteStops[index - 1];
				if (ratio <= right.stop) {
					const localRatio = (ratio - left.stop) / (right.stop - left.stop);
					return interpolateColor(left.color, right.color, localRatio);
				}
			}
			return paletteStops[paletteStops.length - 1].color;
		}

		function applyColorBias(ratio) {
			if (!Number.isFinite(ratio) || ratio <= 0) {
				return 0;
			}
			if (ratio >= 1) {
				return 1;
			}
			const t = clamp(0, 1, (state.colorBias - 0) / 100);
			const minGamma = 0.35;
			const maxGamma = 3.0;
			const gamma = Math.pow(maxGamma, 1 - t) * Math.pow(minGamma, t);
			return Math.pow(ratio, gamma);
		}

		function restoreState() {
			const saved = vscode.getState();
			if (saved && typeof saved.colorBias === 'number') {
				state.colorBias = clamp(0, 100, saved.colorBias);
				colorBiasRange.value = String(state.colorBias);
			}
		}

		function clamp(min, max, value) {
			return Math.min(max, Math.max(min, value));
		}

		function interpolateColor(left, right, ratio) {
			const leftRgb = hexToRgb(left);
			const rightRgb = hexToRgb(right);
			const red = Math.round(leftRgb.r + (rightRgb.r - leftRgb.r) * ratio);
			const green = Math.round(leftRgb.g + (rightRgb.g - leftRgb.g) * ratio);
			const blue = Math.round(leftRgb.b + (rightRgb.b - leftRgb.b) * ratio);
			return 'rgb(' + red + ', ' + green + ', ' + blue + ')';
		}

		function hexToRgb(hex) {
			const normalized = hex.replace('#', '');
			return {
				r: Number.parseInt(normalized.slice(0, 2), 16),
				g: Number.parseInt(normalized.slice(2, 4), 16),
				b: Number.parseInt(normalized.slice(4, 6), 16),
			};
		}

		function baseName(filePath) {
			const pieces = filePath.split('/');
			return pieces[pieces.length - 1] || filePath;
		}

		function formatNumber(value) {
			return new Intl.NumberFormat('zh-CN').format(Number(value || 0));
		}

		function escapeHtml(text) {
			return String(text)
				.replaceAll('&', '&amp;')
				.replaceAll('<', '&lt;')
				.replaceAll('>', '&gt;')
				.replaceAll('"', '&quot;')
				.replaceAll("'", '&#39;');
		}
	</script>
</body>
</html>`;
	}

	private dispose() {
		ProjectHeatmapPanel.currentPanel = undefined;
		while (this.disposables.length > 0) {
			const disposable = this.disposables.pop();
			disposable?.dispose();
		}
	}
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function createNonce(): string {
	let nonce = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let index = 0; index < 32; index += 1) {
		nonce += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return nonce;
}
