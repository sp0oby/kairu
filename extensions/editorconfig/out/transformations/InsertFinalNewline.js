"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InsertFinalNewline = void 0;
const vscode_1 = require("vscode");
const PreSaveTransformation_1 = require("./PreSaveTransformation");
const lineEndings = {
    CR: '\r',
    CRLF: '\r\n',
    LF: '\n',
};
class InsertFinalNewline extends PreSaveTransformation_1.PreSaveTransformation {
    constructor() {
        super(...arguments);
        this.lineEndings = lineEndings;
    }
    transform(editorconfigProperties, doc) {
        var _a, _b;
        const lineCount = doc.lineCount;
        const lastLine = doc.lineAt(lineCount - 1);
        if (shouldIgnoreSetting(editorconfigProperties.insert_final_newline) ||
            lineCount === 0 ||
            lastLine.isEmptyOrWhitespace) {
            return { edits: [] };
        }
        if (((_a = vscode_1.window.activeTextEditor) === null || _a === void 0 ? void 0 : _a.document) === doc) {
            vscode_1.commands.executeCommand('editor.action.insertFinalNewLine');
            return {
                edits: [],
                message: 'editor.action.insertFinalNewLine',
            };
        }
        const position = new vscode_1.Position(lastLine.lineNumber, lastLine.text.length);
        const eol = ((_b = editorconfigProperties.end_of_line) !== null && _b !== void 0 ? _b : 'lf').toUpperCase();
        return {
            edits: [
                vscode_1.TextEdit.insert(position, this.lineEndings[eol]),
            ],
            message: `insertFinalNewline(${eol})`,
        };
        function shouldIgnoreSetting(value) {
            return !value || value === 'unset';
        }
    }
}
exports.InsertFinalNewline = InsertFinalNewline;
//# sourceMappingURL=InsertFinalNewline.js.map