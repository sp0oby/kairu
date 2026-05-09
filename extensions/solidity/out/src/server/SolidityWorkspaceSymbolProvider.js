"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SolidityWorkspaceSymbolProvider = void 0;
const vscode_uri_1 = require("vscode-uri");
const convertDocumentSymbolsToSymbolInformation_1 = require("./utils/convertDocumentSymbolsToSymbolInformation");
class SolidityWorkspaceSymbolProvider {
    provideWorkspaceSymbols(query, walker) {
        walker.initialiseChangedDocuments();
        const allSymbols = [];
        for (const parsed of walker.getParsedDocumentsCache()) {
            const uri = vscode_uri_1.URI.file(parsed.sourceDocument.absolutePath);
            const documentSymbol = parsed.toDocumentSymbol();
            if (documentSymbol) {
                allSymbols.push(...(0, convertDocumentSymbolsToSymbolInformation_1.convertDocumentSymbolsToSymbolInformation)([documentSymbol], uri));
            }
        }
        return allSymbols.filter(symbol => symbol.name.toLowerCase().includes(query.toLowerCase()));
    }
}
exports.SolidityWorkspaceSymbolProvider = SolidityWorkspaceSymbolProvider;
//# sourceMappingURL=SolidityWorkspaceSymbolProvider.js.map