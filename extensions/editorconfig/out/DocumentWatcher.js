"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const vscode_1 = require("vscode");
const transformations_1 = require("./transformations");
const api_1 = require("./api");
const encodingMap = {
    'utf-8': 'utf8',
    'utf-8-bom': 'utf8bom',
    'utf-16le': 'utf16le',
    'utf-16be': 'utf16be',
    latin1: 'iso88591',
};
class DocumentWatcher {
    constructor(outputChannel = vscode_1.window.createOutputChannel('EditorConfig')) {
        this.outputChannel = outputChannel;
        this.preSaveTransformations = [
            new transformations_1.SetEndOfLine(),
            new transformations_1.TrimTrailingWhitespace(),
            new transformations_1.InsertFinalNewline(),
        ];
        this.onEmptyConfig = (relativePath) => {
            this.log(`${relativePath}: No configuration.`);
        };
        this.onBeforeResolve = (relativePath) => {
            this.log(`${relativePath}: Using EditorConfig core...`);
        };
        this.onNoActiveTextEditor = () => {
            this.log('No more open editors.');
        };
        this.onSuccess = (newOptions) => {
            if (!this.doc) {
                this.log(`[no file]: ${JSON.stringify(newOptions)}`);
                return;
            }
            const { relativePath } = (0, api_1.resolveFile)(this.doc);
            this.log(`${relativePath}: ${JSON.stringify(newOptions)}`);
        };
        this.log('Initializing document watcher...');
        const subscriptions = [];
        this.handleTextEditorChange(vscode_1.window.activeTextEditor);
        subscriptions.push(vscode_1.window.onDidChangeActiveTextEditor(async (editor) => {
            this.handleTextEditorChange(editor);
        }));
        subscriptions.push(vscode_1.window.onDidChangeWindowState(async (state) => {
            if (state.focused && this.doc) {
                const newOptions = await (0, api_1.resolveTextEditorOptions)(this.doc, {
                    onEmptyConfig: this.onEmptyConfig,
                });
                (0, api_1.applyTextEditorOptions)(newOptions, {
                    onNoActiveTextEditor: this.onNoActiveTextEditor,
                    onSuccess: this.onSuccess,
                });
            }
        }));
        subscriptions.push(vscode_1.workspace.onDidSaveTextDocument(doc => {
            if (path.basename(doc.fileName) === '.editorconfig') {
                this.log('.editorconfig file saved.');
            }
            // in case document was dirty on text editor change
            this.handleDocumentEncoding(doc);
        }));
        subscriptions.push(vscode_1.workspace.onWillSaveTextDocument(async (e) => {
            const transformations = this.calculatePreSaveTransformations(e.document, e.reason);
            e.waitUntil(transformations);
        }));
        this.disposable = vscode_1.Disposable.from.apply(this, subscriptions);
        this.log('Document watcher initialized');
    }
    log(...messages) {
        this.outputChannel.appendLine(messages.join(' '));
    }
    dispose() {
        this.disposable.dispose();
    }
    async calculatePreSaveTransformations(doc, reason) {
        const editorconfigSettings = await (0, api_1.resolveCoreConfig)(doc, {
            onBeforeResolve: this.onBeforeResolve,
        });
        const relativePath = vscode_1.workspace.asRelativePath(doc.fileName);
        if (!editorconfigSettings) {
            this.log(`${relativePath}: No configuration found for pre-save.`);
            return [];
        }
        return [
            ...this.preSaveTransformations.flatMap(transformer => {
                const { edits, message } = transformer.transform(editorconfigSettings, doc, reason);
                if (edits instanceof Error) {
                    this.log(`${relativePath}: ${edits.message}`);
                    return [];
                }
                if (message) {
                    this.log(`${relativePath}: ${message}`);
                }
                return edits;
            }),
        ];
    }
    async handleTextEditorChange(editor) {
        if (editor === null || editor === void 0 ? void 0 : editor.document) {
            const newOptions = await (0, api_1.resolveTextEditorOptions)((this.doc = editor.document), {
                onEmptyConfig: this.onEmptyConfig,
            });
            (0, api_1.applyTextEditorOptions)(newOptions, {
                onNoActiveTextEditor: this.onNoActiveTextEditor,
                onSuccess: this.onSuccess,
            });
            this.handleDocumentEncoding(editor.document);
        }
    }
    async handleDocumentEncoding(document) {
        const relativePath = vscode_1.workspace.asRelativePath(document.fileName);
        const editorconfigSettings = await (0, api_1.resolveCoreConfig)(document, {
            onBeforeResolve: this.onBeforeResolve,
        });
        const { charset } = editorconfigSettings;
        this.log(`${relativePath}: Target charset is`, charset !== null && charset !== void 0 ? charset : 'not set');
        if (!charset) {
            return;
        }
        if (!(charset in encodingMap)) {
            this.log(`${relativePath}: Unsupported charset`);
            return;
        }
        const targetEncoding = encodingMap[charset];
        if (targetEncoding === document.encoding) {
            return;
        }
        if (document.isDirty) {
            this.log(`${relativePath}: Cannot change encoding, document is dirty`);
            return;
        }
        this.log(`${relativePath}: Re-opening document with ${targetEncoding} encoding...`);
        await vscode_1.workspace.openTextDocument(document.uri, {
            encoding: targetEncoding,
        });
    }
}
exports.default = DocumentWatcher;
//# sourceMappingURL=DocumentWatcher.js.map