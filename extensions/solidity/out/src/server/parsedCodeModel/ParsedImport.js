"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ParsedImport = void 0;
const vscode_languageserver_1 = require("vscode-languageserver");
const parsedCode_1 = require("./parsedCode");
const vscode_uri_1 = require("vscode-uri");
class ParsedImport extends parsedCode_1.ParsedCode {
    constructor() {
        super(...arguments);
        this.documentReference = null;
        this.resolvedImportPath = null;
    }
    initialise(element, document) {
        this.document = document;
        this.element = element;
        this.from = element.from;
    }
    getSelectedTypeReferenceLocation(offset) {
        if (this.isCurrentElementedSelected(offset)) {
            return [parsedCode_1.FindTypeReferenceLocationResult.create(true, this.getReferenceLocation())];
        }
        return [parsedCode_1.FindTypeReferenceLocationResult.create(false)];
    }
    initialiseDocumentReference(parsedDocuments) {
        if (this.resolvedImportPath === null) {
            this.resolvedImportPath = this.document.sourceDocument.resolveImportPath(this.from);
        }
        for (let index = 0; index < parsedDocuments.length; index++) {
            const element = parsedDocuments[index];
            if (element.sourceDocument.absolutePath === this.resolvedImportPath) {
                this.documentReference = element;
                if (this.document.importedDocuments.indexOf(element) < 0) {
                    this.document.addImportedDocument(element);
                }
            }
        }
    }
    getDocumentsThatReference(document, processedDocuments = new Set()) {
        if (this.documentReference !== null) {
            return this.documentReference.getDocumentsThatReference(document, processedDocuments);
        }
        return [];
    }
    getAllReferencesToSelected(offset, documents) {
        if (this.isCurrentElementedSelected(offset)) {
            return this.getAllReferencesToObject(this.documentReference);
        }
        return [];
    }
    getReferenceLocation() {
        if (this.resolvedImportPath === null) {
            this.resolvedImportPath = this.document.sourceDocument.resolveImportPath(this.from);
        }
        // note: we can use the path to find the referenced source document too.
        return vscode_languageserver_1.Location.create(vscode_uri_1.URI.file(this.resolvedImportPath).toString(), vscode_languageserver_1.Range.create(0, 0, 0, 0));
    }
    toDocumentSymbol() {
        const importRange = this.getRange();
        // Display the import details
        const resolvedPath = this.getResolvedImportPath();
        const detail = `Import from: ${this.from}\nResolved to: ${resolvedPath}`;
        return vscode_languageserver_1.DocumentSymbol.create(`import "${this.from}"`, detail, // Additional metadata
        vscode_languageserver_1.SymbolKind.File, // Represent imports as files
        importRange, importRange);
    }
    getResolvedImportPath() {
        if (this.resolvedImportPath === null) {
            this.resolvedImportPath = this.document.sourceDocument.resolveImportPath(this.from);
        }
        return this.resolvedImportPath;
    }
}
exports.ParsedImport = ParsedImport;
//# sourceMappingURL=ParsedImport.js.map