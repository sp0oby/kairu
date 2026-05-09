"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertDocumentSymbolsToSymbolInformation = void 0;
const vscode_languageserver_types_1 = require("vscode-languageserver-types");
function convertDocumentSymbolsToSymbolInformation(symbols, uri, containerName) {
    const result = [];
    for (const symbol of symbols) {
        result.push({
            name: symbol.name,
            kind: symbol.kind,
            location: vscode_languageserver_types_1.Location.create(uri.toString(), symbol.selectionRange),
            containerName,
        });
        if (symbol.children && symbol.children.length > 0) {
            result.push(...convertDocumentSymbolsToSymbolInformation(symbol.children, uri, symbol.name));
        }
    }
    return result;
}
exports.convertDocumentSymbolsToSymbolInformation = convertDocumentSymbolsToSymbolInformation;
//# sourceMappingURL=convertDocumentSymbolsToSymbolInformation.js.map