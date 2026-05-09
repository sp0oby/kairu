"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ParsedDeclarationType = void 0;
const parsedCode_1 = require("./parsedCode");
class ParsedDeclarationType extends parsedCode_1.ParsedCode {
    constructor() {
        super(...arguments);
        this.parentTypeName = null;
        this.type = null;
        this.mappingValueType = null;
        this.mappingKeyType = null;
    }
    static create(literal, contract, document) {
        const declarationType = new ParsedDeclarationType();
        declarationType.initialise(literal, document, contract);
        return declarationType;
    }
    initialise(element, document, contract, isGlobal = false) {
        super.initialise(element, document, contract, isGlobal);
        if (element.members !== undefined && element.members.length > 0) {
            this.name = element.members[0];
            this.parentTypeName = element.literal;
        }
        else {
            if (element.literal.literal !== undefined) {
                this.name = element.literal.literal;
            }
            else {
                this.name = element.literal;
            }
        }
        this.isArray = element.array_parts.length > 0;
        this.isMapping = false;
        const literalType = element.literal;
        if (typeof literalType.type !== 'undefined') {
            this.isMapping = literalType.type === 'MappingExpression';
            // Extract key and value types from mapping expression
            if (this.isMapping) {
                this.name = 'mapping';
                this.mappingKeyType = this.getTypeString(literalType.from);
                this.mappingValueType = this.getTypeString(literalType.to);
            }
        }
    }
    getInnerCompletionItems() {
        const result = [];
        this.getExtendedMethodCallsFromUsing().forEach(x => result.push(x.createCompletionItem()));
        if (this.isMapping && this.mappingValueType !== null) {
            const valueType = this.findTypeInScope(this.mappingValueType);
            if (valueType !== null && valueType !== undefined) {
                return result.concat(valueType.getInnerCompletionItems());
            }
        }
        const type = this.findType();
        if (type === null || type === undefined) {
            return result;
        }
        return result.concat(type.getInnerCompletionItems());
    }
    getInnerMembers() {
        if (this.isMapping && this.mappingValueType !== null) {
            const valueType = this.findTypeInScope(this.mappingValueType);
            if (valueType !== null && valueType !== undefined) {
                return valueType.getInnerMembers();
            }
        }
        const type = this.findType();
        if (type === null || type === undefined) {
            return [];
        }
        return type.getInnerMembers();
    }
    getInnerMethodCalls() {
        let result = [];
        result = result.concat(this.getExtendedMethodCallsFromUsing());
        if (this.isMapping && this.mappingValueType !== null) {
            const valueType = this.findTypeInScope(this.mappingValueType);
            if (valueType !== null && valueType !== undefined) {
                return result.concat(valueType.getInnerMethodCalls());
            }
        }
        const type = this.findType();
        if (type === null || type === undefined) {
            return result;
        }
        return result.concat(type.getInnerMethodCalls());
    }
    getExtendedMethodCallsFromUsing() {
        let usings = [];
        if (this.contract !== null) {
            usings = this.contract.getAllUsing(this);
        }
        else {
            usings = this.document.getAllGlobalUsing(this);
        }
        let result = [];
        usings.forEach(usingItem => {
            const foundLibrary = this.document.getAllContracts().find(x => x.name === usingItem.name);
            if (foundLibrary !== undefined) {
                const allfunctions = foundLibrary.getAllFunctions();
                const filteredFunctions = allfunctions.filter(x => {
                    if (x.input.length > 0) {
                        const typex = x.input[0].type;
                        let validTypeName = false;
                        if (typex.name === this.name || (this.name === 'address_payable' && typex.name === 'address')) {
                            validTypeName = true;
                        }
                        return typex.isArray === this.isArray && validTypeName && typex.isMapping === this.isMapping;
                    }
                    return false;
                });
                result = result.concat(filteredFunctions);
            }
        });
        return result;
    }
    findType() {
        if (this.type === null) {
            if (this.parentTypeName !== null) {
                const parentType = this.findTypeInScope(this.parentTypeName);
                if (parentType !== undefined) {
                    this.type = parentType.findTypeInScope(this.name);
                }
            }
            else {
                this.type = this.findTypeInScope(this.name);
            }
        }
        if (this.isMapping && this.mappingValueType !== null) {
            const valueType = this.findTypeInScope(this.mappingValueType);
            if (valueType !== null && valueType !== undefined) {
                return valueType;
            }
        }
        return this.type;
    }
    getAllReferencesToSelected(offset, documents) {
        if (this.isCurrentElementedSelected(offset)) {
            const type = this.findType();
            return type.getAllReferencesToThis(documents);
        }
        return [];
    }
    getAllReferencesToObject(parsedCode) {
        if (this.isTheSame(parsedCode)) {
            return [this.createFoundReferenceLocationResult()];
        }
        const type = this.findType();
        if (this.type != null && this.type.isTheSame(parsedCode)) {
            return [this.createFoundReferenceLocationResult()];
        }
        return [];
    }
    getInfo() {
        let returnString = '';
        if (this.isArray) {
            returnString = '### Array \n';
        }
        if (this.isMapping) {
            returnString = '### Mapping (' + this.mappingKeyType + ' => ' + this.getMappingValueInfo(this.mappingValueType) + ') \n';
        }
        const type = this.findType();
        if (this.type != null) {
            return returnString + type.getInfo();
        }
        return returnString + '### ' + this.name;
    }
    getMappingValueInfo(literalType) {
        if (typeof literalType.type !== 'undefined') {
            if (literalType.type === 'MappingExpression') {
                const from = this.getTypeString(literalType.from);
                const literal = literalType.to;
                if (typeof literal === 'string') {
                    return 'Mapping (' + from + ' => ' + literal + ')';
                }
                if (typeof literal.type !== 'undefined') {
                    if (literal.type === 'MappingExpression') {
                        return 'Mapping (' + from + ' => ' + this.findMappingValueType(literal) + ')';
                    }
                }
                if (literal && typeof literal.literal !== 'undefined') {
                    return 'Mapping (' + from + ' => ' + literal.literal + ')';
                }
                if (literal && typeof literal.name !== 'undefined') {
                    return 'Mapping (' + from + ' => ' + literal.name + ')';
                }
            }
        }
        return literalType;
    }
    getSimpleInfo() {
        let returnString = '';
        if (this.isArray) {
            returnString = 'Array:';
        }
        if (this.isMapping) {
            returnString = 'Mapping:';
        }
        const type = this.findType();
        if (this.type != null) {
            return returnString + type.getSimpleInfo();
        }
        return returnString + ' ' + this.name;
    }
    getTypeString(literal) {
        if (typeof literal === 'string') {
            return literal;
        }
        if (literal && typeof literal.literal !== 'undefined') {
            return literal.literal;
        }
        if (literal && typeof literal.name !== 'undefined') {
            return literal.name;
        }
        return 'unknown';
    }
}
exports.ParsedDeclarationType = ParsedDeclarationType;
//# sourceMappingURL=parsedDeclarationType.js.map