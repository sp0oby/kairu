"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ParsedUsing = void 0;
const parsedCode_1 = require("./parsedCode");
const parsedDeclarationType_1 = require("./parsedDeclarationType");
const vscode_languageserver_1 = require("vscode-languageserver");
class ParsedUsing extends parsedCode_1.ParsedCode {
    constructor() {
        super(...arguments);
        this.forStar = false;
    }
    initialise(element, document, contract, isGlobal) {
        this.contract = contract;
        this.element = element;
        this.name = element.library.literal;
        this.document = document;
        this.isGlobal = isGlobal;
        if (element.for === null) {
            this.for = null;
        }
        else {
            if (element.for === '*') {
                this.forStar = true;
                this.for = null;
            }
            else {
                this.for = parsedDeclarationType_1.ParsedDeclarationType.create(element.for, this.contract, this.document);
            }
        }
    }
    getSelectedTypeReferenceLocation(offset) {
        if (this.isCurrentElementedSelected(offset)) {
            if (this.for !== null) {
                const foundType = this.for.findType();
                if (foundType !== undefined) {
                    return [foundType.createFoundReferenceLocationResult()];
                }
                return [this.createFoundReferenceLocationResultNoLocation()];
            }
        }
        return [this.createNotFoundReferenceLocationResult()];
    }
    toDocumentSymbol() {
        var _a;
        const usingRange = this.getRange();
        // Detail about the `for` type or `*` for global applicability
        const forTypeDetail = this.forStar
            ? 'for *'
            : `for ${((_a = this.for) === null || _a === void 0 ? void 0 : _a.name) || 'unknown'}`;
        return vscode_languageserver_1.DocumentSymbol.create(`using ${this.name} ${forTypeDetail}`, // Display name in Outline view
        `Library: ${this.name}, ${forTypeDetail}`, // Additional details
        vscode_languageserver_1.SymbolKind.Namespace, // `using` is closely related to a namespace
        usingRange, usingRange);
    }
}
exports.ParsedUsing = ParsedUsing;
//# sourceMappingURL=parsedUsing.js.map