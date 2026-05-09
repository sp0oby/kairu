'use strict';
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path = __importStar(require("path"));
const solcCompiler_1 = require("./common/solcCompiler");
const solhint_1 = __importDefault(require("./server/linter/solhint"));
const solium_1 = __importDefault(require("./server/linter/solium"));
const completionService_1 = require("./server/completionService");
const SolidityDefinitionProvider_1 = require("./server/SolidityDefinitionProvider");
const SolidityReferencesProvider_1 = require("./server/SolidityReferencesProvider");
const SolidityDocumentSymbolProvider_1 = require("./server/SolidityDocumentSymbolProvider");
const SolidityHoverProvider_1 = require("./server/SolidityHoverProvider");
const SolidityWorkspaceSymbolProvider_1 = require("./server/SolidityWorkspaceSymbolProvider");
const node_1 = require("vscode-languageserver/node");
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
const vscode_uri_1 = require("vscode-uri");
const codeWalkerService_1 = require("./server/parsedCodeModel/codeWalkerService");
const util_1 = require("./common/util");
const projectService_1 = require("./common/projectService");
const fs_1 = require("fs");
const standAloneServerSide = false; // put this in the package json .. use this setting to build
// import * as path from 'path';
// Create a connection for the server
const connection = (0, node_1.createConnection)(node_1.ProposedFeatures.all);
console.log = connection.console.log.bind(connection.console);
console.error = connection.console.error.bind(connection.console);
const defaultSoliditySettings = {};
let packageJson;
try {
    const packageJsonPath = path.resolve(__dirname, '../../package.json');
    packageJson = JSON.parse((0, fs_1.readFileSync)(packageJsonPath, 'utf-8'));
    if (packageJson &&
        typeof packageJson === 'object' &&
        packageJson.contributes &&
        typeof packageJson.contributes === 'object' &&
        packageJson.contributes.configuration &&
        typeof packageJson.contributes.configuration === 'object' &&
        packageJson.contributes.configuration.properties &&
        typeof packageJson.contributes.configuration.properties === 'object') {
        Object.entries(packageJson.contributes.configuration.properties)
            .forEach(([key, value]) => {
            const keys = key.split('.');
            if (keys.length === 2 && keys[0] === 'solidity') {
                defaultSoliditySettings[keys[1]] = value.default;
            }
        });
    }
    else {
        console.error("⚠️ package.json loaded but 'contributes' key is missing.");
    }
}
catch (error) {
    console.error('❌ Error loading package.json:', error.message);
}
const documents = new node_1.TextDocuments(vscode_languageserver_textdocument_1.TextDocument);
let rootPath;
let solcCompiler;
let linter = null;
let enabledAsYouTypeErrorCheck = false;
let compileUsingRemoteVersion = '';
let compileUsingLocalVersion = '';
let nodeModulePackage = '';
let defaultCompiler = solcCompiler_1.compilerType.embedded;
let solhintDefaultRules = {};
let soliumDefaultRules = {};
let solhintPackageDirectory = '';
let validationDelay = 1500;
let solcCachePath = '';
let hasWorkspaceFolderCapability = false;
let monoRepoSupport = false;
let evmVersion = '';
let viaIR = false;
// flags to avoid trigger concurrent validations (compiling is slow)
let validatingDocument = false;
let validatingAllDocuments = false;
let packageDefaultDependenciesDirectory = ['lib', 'node_modules'];
let packageDefaultDependenciesContractsDirectory = ['src', 'contracts', ''];
let workspaceFolders;
let remappings = [];
let selectedDocument = null;
let selectedProjectFolder = null;
let codeWalkerService = null;
const codeWalkerServiceCache = [];
function removeAllCodeWalkerServiceFromCacheThatAreNotInCurrentWorkspacesOrSettings() {
    codeWalkerServiceCache.forEach(x => {
        if (!workspaceFolders.find(y => x.rootPath.startsWith(vscode_uri_1.URI.parse(y.uri).fsPath))) {
            removeCodeWalkerServiceFromCache(x.rootPath);
        }
    });
}
function removeCodeWalkerServiceFromCache(projectFolder) {
    const index = codeWalkerServiceCache.findIndex(x => x.isTheSameCodeWalkerservice(projectFolder));
    if (index !== -1) {
        codeWalkerServiceCache.splice(index, 1);
    }
}
function getCodeWalkerServiceFromCache(projectFolder) {
    return codeWalkerServiceCache.find(x => x.isTheSameCodeWalkerservice(projectFolder));
}
function getCodeWalkerServiceFromCacheAndCreateIfNotExistsOrSettingsChanged(projectFolder) {
    removeAllCodeWalkerServiceFromCacheThatAreNotInCurrentWorkspacesOrSettings();
    let cacheCodeWalkerService = getCodeWalkerServiceFromCache(projectFolder);
    if (cacheCodeWalkerService !== undefined) {
        if (cacheCodeWalkerService.hasTheSameDependencySettings(packageDefaultDependenciesDirectory, packageDefaultDependenciesContractsDirectory, remappings)) {
            codeWalkerService = cacheCodeWalkerService;
            return cacheCodeWalkerService;
        }
        else {
            removeCodeWalkerServiceFromCache(selectedProjectFolder);
        }
    }
    cacheCodeWalkerService = new codeWalkerService_1.CodeWalkerService(selectedProjectFolder, packageDefaultDependenciesDirectory, packageDefaultDependenciesContractsDirectory, remappings);
    cacheCodeWalkerService.initialiseAllDocuments();
    codeWalkerServiceCache.push(cacheCodeWalkerService);
    return cacheCodeWalkerService;
}
function getCodeWalkerService() {
    if (codeWalkerService !== null) {
        if (codeWalkerService.isTheSameCodeWalkerservice(selectedProjectFolder)) {
            if (codeWalkerService.hasTheSameDependencySettings(packageDefaultDependenciesDirectory, packageDefaultDependenciesContractsDirectory, remappings)) {
                return codeWalkerService;
            }
        }
    }
    codeWalkerService = getCodeWalkerServiceFromCacheAndCreateIfNotExistsOrSettingsChanged(selectedProjectFolder);
    return codeWalkerService;
}
function initWorkspaceRootFolder(uri) {
    if (rootPath !== 'undefined') {
        const fullUri = vscode_uri_1.URI.parse(uri);
        if (!fullUri.fsPath.startsWith(rootPath)) {
            if (workspaceFolders) {
                const newRootFolder = workspaceFolders.find(x => uri.startsWith(x.uri));
                if (newRootFolder !== undefined) {
                    rootPath = vscode_uri_1.URI.parse(newRootFolder.uri).fsPath;
                    solcCompiler.rootPath = rootPath;
                    if (linter !== null) {
                        linter.loadFileConfig(rootPath);
                    }
                }
            }
        }
    }
}
function initCurrentProjectInWorkspaceRootFsPath(currentDocument) {
    if (monoRepoSupport) {
        if (selectedDocument === currentDocument && selectedProjectFolder != null) {
            return selectedProjectFolder;
        }
        const projectFolder = (0, projectService_1.findFirstRootProjectFile)(rootPath, vscode_uri_1.URI.parse(currentDocument).fsPath);
        if (projectFolder == null) {
            selectedProjectFolder = rootPath;
            selectedDocument = currentDocument;
            return rootPath;
        }
        else {
            selectedProjectFolder = projectFolder;
            selectedDocument = currentDocument;
            solcCompiler.rootPath = projectFolder;
            if (linter !== null) {
                linter.loadFileConfig(projectFolder);
            }
            return projectFolder;
        }
    }
    else {
        // we might have changed settings
        solcCompiler.rootPath = rootPath;
        selectedProjectFolder = rootPath;
        selectedDocument = currentDocument;
        return rootPath;
    }
}
function validate(document) {
    try {
        initWorkspaceRootFolder(document.uri);
        initCurrentProjectInWorkspaceRootFsPath(document.uri);
        validatingDocument = true;
        const uri = document.uri;
        const filePath = vscode_uri_1.URI.parse(uri).fsPath;
        const documentText = document.getText();
        let linterDiagnostics = [];
        const compileErrorDiagnostics = [];
        try {
            if (linter !== null) {
                linterDiagnostics = linter.validate(filePath, documentText);
            }
        }
        catch (_a) {
            // gracefull catch
        }
        try {
            if (enabledAsYouTypeErrorCheck) {
                connection.console.info('Validating using the compiler selected: ' + solcCompiler.getLoadedCompilerType());
                connection.console.info('Validating using compiler version: ' + solcCompiler.getLoadedVersion());
                connection.console.info('Validating using compiler selected version: ' + solcCompiler.getSelectedVersion());
                // connection.console.info('remappings: ' +  remappings.join(','));
                // connection.console.info(packageDefaultDependenciesDirectory.join(','));
                // connection.console.info(packageDefaultDependenciesContractsDirectory.join(','));
                // connection.console.info('Validating using compiler configured version: ' +  compileUsingRemoteVersion);
                const errors = solcCompiler
                    .compileSolidityDocumentAndGetDiagnosticErrors(filePath, documentText, packageDefaultDependenciesDirectory, packageDefaultDependenciesContractsDirectory, remappings, null, evmVersion);
                errors.forEach(errorItem => {
                    const uriCompileError = vscode_uri_1.URI.file(errorItem.fileName);
                    if (uriCompileError.toString() === uri) {
                        compileErrorDiagnostics.push(errorItem.diagnostic);
                    }
                });
            }
        }
        catch (e) {
            connection.console.info(e.message);
        }
        const diagnostics = linterDiagnostics.concat(compileErrorDiagnostics);
        connection.sendDiagnostics({ uri: document.uri, diagnostics });
    }
    finally {
        validatingDocument = false;
    }
}
function updateSoliditySettings(soliditySettings) {
    enabledAsYouTypeErrorCheck = soliditySettings.enabledAsYouTypeCompilationErrorCheck;
    compileUsingLocalVersion = soliditySettings.compileUsingLocalVersion;
    compileUsingRemoteVersion = soliditySettings.compileUsingRemoteVersion;
    solhintDefaultRules = soliditySettings.solhintRules;
    soliumDefaultRules = soliditySettings.soliumRules;
    solhintPackageDirectory = soliditySettings.solhintPackageDirectory;
    validationDelay = soliditySettings.validationDelay;
    nodeModulePackage = soliditySettings.nodemodulespackage;
    defaultCompiler = solcCompiler_1.compilerType[soliditySettings.defaultCompiler];
    evmVersion = soliditySettings.evmVersion;
    viaIR = soliditySettings.viaIR;
    // connection.console.info('changing settings: ' +  soliditySettings.compileUsingRemoteVersion);
    // connection.console.info('changing settings: ' +  compileUsingRemoteVersion);
    connection.console.info(defaultCompiler.toString());
    if (typeof soliditySettings.packageDefaultDependenciesDirectory === 'string') {
        packageDefaultDependenciesDirectory = [soliditySettings.packageDefaultDependenciesDirectory];
    }
    else {
        packageDefaultDependenciesDirectory = soliditySettings.packageDefaultDependenciesDirectory;
    }
    if (typeof soliditySettings.packageDefaultDependenciesContractsDirectory === 'string') {
        packageDefaultDependenciesContractsDirectory = [soliditySettings.packageDefaultDependenciesContractsDirectory];
    }
    else {
        packageDefaultDependenciesContractsDirectory = soliditySettings.packageDefaultDependenciesContractsDirectory;
    }
    remappings = soliditySettings.remappings;
    monoRepoSupport = soliditySettings.monoRepoSupport;
    if (process.platform === 'win32') {
        remappings = (0, util_1.replaceRemappings)(remappings, soliditySettings.remappingsWindows);
    }
    else {
        remappings = (0, util_1.replaceRemappings)(remappings, soliditySettings.remappingsUnix);
    }
    switch (linterName(soliditySettings)) {
        case 'solhint': {
            linter = new solhint_1.default(rootPath, solhintDefaultRules, solhintPackageDirectory);
            break;
        }
        case 'solium': {
            linter = new solium_1.default(rootPath, soliumDefaultRules, connection);
            break;
        }
        default: {
            linter = null;
        }
    }
    if (linter !== null) {
        linter.setIdeRules(linterRules(soliditySettings));
    }
    startValidation();
}
connection.onSignatureHelp(() => {
    return null;
});
connection.onCompletion((textDocumentPosition) => {
    let completionItems = [];
    const document = documents.get(textDocumentPosition.textDocument.uri);
    const projectRootPath = initCurrentProjectInWorkspaceRootFsPath(document.uri);
    const service = new completionService_1.CompletionService(projectRootPath);
    completionItems = completionItems.concat(service.getAllCompletionItems(document, textDocumentPosition.position, getCodeWalkerService()));
    return [...new Set(completionItems)];
});
connection.onReferences((handler) => {
    initWorkspaceRootFolder(handler.textDocument.uri);
    initCurrentProjectInWorkspaceRootFsPath(handler.textDocument.uri);
    const provider = new SolidityReferencesProvider_1.SolidityReferencesProvider();
    return provider.provideReferences(documents.get(handler.textDocument.uri), handler.position, getCodeWalkerService());
});
connection.onDefinition((handler) => {
    initWorkspaceRootFolder(handler.textDocument.uri);
    initCurrentProjectInWorkspaceRootFsPath(handler.textDocument.uri);
    const provider = new SolidityDefinitionProvider_1.SolidityDefinitionProvider();
    return provider.provideDefinition(documents.get(handler.textDocument.uri), handler.position, getCodeWalkerService());
});
connection.onHover((handler) => {
    initWorkspaceRootFolder(handler.textDocument.uri);
    initCurrentProjectInWorkspaceRootFsPath(handler.textDocument.uri);
    const provider = new SolidityHoverProvider_1.SolidityHoverProvider();
    return provider.provideHover(documents.get(handler.textDocument.uri), handler.position, getCodeWalkerService());
});
// This handler resolve additional information for the item selected in
// the completion list.
// connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
//   item.
// });
function validateAllDocuments() {
    if (!validatingAllDocuments) {
        try {
            validatingAllDocuments = true;
            documents.all().forEach(document => validate(document));
        }
        finally {
            validatingAllDocuments = false;
        }
    }
}
function startValidation() {
    if (enabledAsYouTypeErrorCheck) {
        // connection.console.info('changing settings: ' +  compileUsingRemoteVersion);
        solcCompiler.initialiseAllCompilerSettings(compileUsingRemoteVersion, compileUsingLocalVersion, nodeModulePackage, defaultCompiler);
        solcCompiler.initialiseSelectedCompiler().then(() => {
            connection.console.info('Validating using the compiler selected: ' + solcCompiler_1.compilerType[defaultCompiler]);
            connection.console.info('Validating using compiler version: ' + solcCompiler.getLoadedVersion());
            validateAllDocuments();
        }).catch(reason => {
            connection.console.error('An error has occurred initialising the compiler selected ' + solcCompiler_1.compilerType[defaultCompiler] + ', please check your settings, reverting to the embedded compiler. Error: ' + reason);
            solcCompiler.initialiseAllCompilerSettings(compileUsingRemoteVersion, compileUsingLocalVersion, nodeModulePackage, solcCompiler_1.compilerType.embedded);
            solcCompiler.initialiseSelectedCompiler().then(() => {
                validateAllDocuments();
                // tslint:disable-next-line:no-empty
            }).catch(() => { });
        });
    }
    else {
        validateAllDocuments();
    }
}
function onDidChangeContent(event) {
    const document = event.document;
    if (!validatingDocument && !validatingAllDocuments) {
        validatingDocument = true; // control the flag at a higher level
        // slow down, give enough time to type (1.5 seconds?)
        setTimeout(() => solcCompiler.initialiseSelectedCompiler().then(() => {
            validate(document);
        }), validationDelay);
        getCodeWalkerService().refreshDocument(document);
    }
}
documents.onDidSave(onDidChangeContent);
documents.onDidChangeContent(onDidChangeContent);
connection.onDocumentSymbol((params) => {
    const document = documents.get(params.textDocument.uri);
    if (document) {
        // Initialize project root and ensure CodeWalkerService is up-to-date
        initWorkspaceRootFolder(document.uri);
        initCurrentProjectInWorkspaceRootFsPath(document.uri);
        // Use the provider to generate document symbols
        const provider = new SolidityDocumentSymbolProvider_1.SolidityDocumentSymbolProvider();
        const symbols = provider.provideDocumentSymbols(document, getCodeWalkerService());
        // Return the generated symbols
        return symbols || [];
    }
    return [];
});
connection.onWorkspaceSymbol((params) => {
    const provider = new SolidityWorkspaceSymbolProvider_1.SolidityWorkspaceSymbolProvider();
    if (!selectedProjectFolder) {
        return [];
    }
    const projectFolder = initCurrentProjectInWorkspaceRootFsPath(selectedProjectFolder);
    const walker = getCodeWalkerServiceFromCacheAndCreateIfNotExistsOrSettingsChanged(projectFolder);
    return provider.provideWorkspaceSymbols(params.query, walker);
});
// remove diagnostics from the Problems panel when we close the file
documents.onDidClose(event => connection.sendDiagnostics({
    diagnostics: [],
    uri: event.document.uri,
}));
documents.listen(connection);
connection.onInitialize((params) => {
    rootPath = params.rootPath;
    const capabilities = params.capabilities;
    hasWorkspaceFolderCapability = !!(capabilities.workspace && !!capabilities.workspace.workspaceFolders);
    if (params.workspaceFolders) {
        workspaceFolders = params.workspaceFolders;
    }
    if (params.initializationOptions && typeof params.initializationOptions === 'string') {
        solcCachePath = params.initializationOptions;
    }
    else {
        solcCachePath = '';
    }
    solcCompiler = new solcCompiler_1.SolcCompiler(rootPath);
    solcCompiler.setSolcCache(solcCachePath);
    const result = {
        capabilities: {
            completionProvider: {
                resolveProvider: false,
                triggerCharacters: ['.'],
            },
            definitionProvider: true,
            referencesProvider: true,
            hoverProvider: true,
            textDocumentSync: node_1.TextDocumentSyncKind.Full,
            documentSymbolProvider: true,
            workspaceSymbolProvider: true,
        },
    };
    if (hasWorkspaceFolderCapability) {
        result.capabilities.workspace = {
            workspaceFolders: {
                supported: true,
            },
        };
    }
    if (standAloneServerSide) {
        updateSoliditySettings(defaultSoliditySettings);
    }
    return result;
});
connection.onInitialized(() => {
    if (hasWorkspaceFolderCapability) {
        connection.workspace.onDidChangeWorkspaceFolders(_event => {
            if (connection.workspace !== undefined) {
                connection.workspace.onDidChangeWorkspaceFolders((event) => {
                    event.removed.forEach(workspaceFolder => {
                        const index = workspaceFolders.findIndex((folder) => folder.uri === workspaceFolder.uri);
                        if (index !== -1) {
                            workspaceFolders.splice(index, 1);
                        }
                    });
                    event.added.forEach(workspaceFolder => {
                        workspaceFolders.push(workspaceFolder);
                    });
                });
            }
        });
    }
});
connection.onDidChangeWatchedFiles(_change => {
    if (linter !== null) {
        linter.loadFileConfig(rootPath);
    }
    validateAllDocuments();
});
connection.onDidChangeConfiguration((change) => {
    var _a, _b;
    if (standAloneServerSide) {
        updateSoliditySettings(Object.assign(Object.assign({}, defaultSoliditySettings), (((_a = change.settings) === null || _a === void 0 ? void 0 : _a.solidity) || {})));
    }
    else {
        updateSoliditySettings((_b = change.settings) === null || _b === void 0 ? void 0 : _b.solidity);
    }
});
function linterName(settings) {
    return settings.linter;
}
function linterRules(settings) {
    const _linterName = linterName(settings);
    if (_linterName === 'solium') {
        return settings.soliumRules;
    }
    else {
        return settings.solhintRules;
    }
}
connection.listen();
//# sourceMappingURL=server.js.map