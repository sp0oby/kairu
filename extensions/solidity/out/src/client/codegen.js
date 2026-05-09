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
Object.defineProperty(exports, "__esModule", { value: true });
exports.codeGenerateCQS = exports.codeGenerateAllFilesFromAbiInCurrentFolder = exports.codeGenerateNethereumCQSCSharpAll = exports.codeGenerateNethereumCQSFSharpAll = exports.codeGenerateNethereumCQSVbAll = exports.codeGenerateNethereumCQSFSharp = exports.codeGenerateNethereumCQSVbNet = exports.codeGenerateNethereumCQSCsharp = exports.codeGenerateAllFilesFromNethereumGenAbisFile = exports.generateNethereumMultiSettingsFile = exports.generateNethereumCodeSettingsFile = exports.getProjectExtensionFromLang = exports.autoCodeGenerateAfterCompilation = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const codegen = __importStar(require("nethereum-codegen"));
const projectService_1 = require("../common/projectService");
const workspaceUtil = __importStar(require("./workspaceUtil"));
const settingsService_1 = require("./settingsService");
const outputChannelService_1 = require("./outputChannelService");
function autoCodeGenerateAfterCompilation(compiledFiles, args, diagnostics, root = null) {
    if (compiledFiles !== undefined && compiledFiles.length > 0) {
        const settings = getCodeGenerationSettings(root);
        if (settings !== undefined) {
            if (settings.autoCodeGen === true) {
                let lang = 0;
                if (settings.lang !== undefined) {
                    lang = settings.lang;
                }
                compiledFiles.forEach(file => {
                    codeGenerateCQS(file, lang, args, diagnostics, root);
                });
            }
        }
    }
}
exports.autoCodeGenerateAfterCompilation = autoCodeGenerateAfterCompilation;
function getProjectExtensionFromLang(lang) {
    switch (lang) {
        case 0:
            return '.csproj';
        case 1:
            return '.vbproj';
        case 3:
            return '.fsproj';
    }
}
exports.getProjectExtensionFromLang = getProjectExtensionFromLang;
function generateNethereumCodeSettingsFile(root = null) {
    if (root == null) {
        root = workspaceUtil.getCurrentProjectInWorkspaceRootFsPath();
    }
    const settingsFile = path.join(root, 'nethereum-gen.settings');
    if (!fs.existsSync(settingsFile)) {
        const prettyRootName = prettifyRootNameAsNamespace(path.basename(root));
        const baseNamespace = prettyRootName + '.Contracts';
        const jsonSettings = {
            'projectName': prettyRootName,
            // tslint:disable-next-line:object-literal-sort-keys
            'namespace': baseNamespace,
            'lang': 0,
            'autoCodeGen': true,
            'projectPath': '../',
        };
        fs.writeFileSync(settingsFile, JSON.stringify(jsonSettings, null, 4));
    }
}
exports.generateNethereumCodeSettingsFile = generateNethereumCodeSettingsFile;
function generateNethereumMultiSettingsFile(root = null) {
    if (root == null) {
        root = workspaceUtil.getCurrentProjectInWorkspaceRootFsPath();
    }
    const settingsFile = path.join(root, '.nethereum-gen.multisettings');
    if (!fs.existsSync(settingsFile)) {
        const prettyRootName = prettifyRootNameAsNamespace(path.basename(root));
        const jsonTemplate = [
            {
                paths: [
                    'out/YourContract.sol/YourContract.json',
                    'out/AnotherContract.sol/AnotherContract.json',
                ],
                generatorConfigs: [
                    {
                        baseNamespace: `${prettyRootName}.Contracts`,
                        basePath: `../${prettyRootName}/${prettyRootName}.Contracts`,
                        codeGenLang: 0,
                        generatorType: 'ContractDefinition',
                    },
                    {
                        baseNamespace: `${prettyRootName}.Contracts`,
                        basePath: `../${prettyRootName}/${prettyRootName}.Contracts`,
                        codeGenLang: 0,
                        generatorType: 'MudExtendedService',
                    },
                    {
                        baseNamespace: `${prettyRootName}.Contracts`,
                        basePath: `../${prettyRootName}/${prettyRootName}.Contracts`,
                        codeGenLang: 0,
                        generatorType: 'BlazorPageService',
                    },
                ],
            },
            {
                paths: ['mud.config.ts'],
                generatorConfigs: [
                    {
                        baseNamespace: `${prettyRootName}.Contracts.Tables`,
                        basePath: `../${prettyRootName}Contracts/Tables`,
                        generatorType: 'MudTables',
                    },
                ],
            },
        ];
        fs.writeFileSync(settingsFile, JSON.stringify(jsonTemplate, null, 4));
    }
}
exports.generateNethereumMultiSettingsFile = generateNethereumMultiSettingsFile;
function codeGenerateAllFilesFromNethereumGenAbisFile(args, diagnostics, root = null) {
    try {
        const settingsPath = args.fsPath;
        const fileName = path.basename(settingsPath);
        const isValid = fileName.match(/^(.*\.)?nethereum-gen\.multisettings$/);
        if (isValid) {
            if (fs.existsSync(settingsPath)) {
                const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
                if (root == null) {
                    root = workspaceUtil.getCurrentProjectInWorkspaceRootFsPath();
                }
                const files = codegen.generateFilesFromConfigSetsArray(settings, root);
                const outputChannel = outputChannelService_1.OutputChannelService.getInstance().getNethereumCodeGenerationOutputChannel();
                outputChannel.clear();
                outputChannel.appendLine('Code generation completed');
                files.forEach(file => {
                    outputChannel.appendLine(file);
                });
            }
            else {
                throw 'nethereum-gen.multisettings not found';
            }
        }
    }
    catch (e) {
        const outputChannel = outputChannelService_1.OutputChannelService.getInstance().getNethereumCodeGenerationOutputChannel();
        outputChannel.clear();
        outputChannel.appendLine('Error generating code:');
        outputChannel.appendLine('Please provide a valid file named: nethereum-gen.multisettings at the project root, with paths containing properly formatted xxx.abi or yyy.json files from the compilation output of the extension (bin folder) or other tools like fondry (out folder)');
        outputChannel.appendLine(e.message);
        outputChannel.show();
    }
}
exports.codeGenerateAllFilesFromNethereumGenAbisFile = codeGenerateAllFilesFromNethereumGenAbisFile;
function codeGenerateNethereumCQSCsharp(args, diagnostics, root = null) {
    const lang = 0;
    const editor = vscode.window.activeTextEditor;
    const fileName = editor.document.fileName;
    codeGenerateCQS(fileName, lang, args, diagnostics, root);
}
exports.codeGenerateNethereumCQSCsharp = codeGenerateNethereumCQSCsharp;
function codeGenerateNethereumCQSVbNet(args, diagnostics, root = null) {
    const lang = 1;
    const editor = vscode.window.activeTextEditor;
    const fileName = editor.document.fileName;
    codeGenerateCQS(fileName, lang, args, diagnostics, root);
}
exports.codeGenerateNethereumCQSVbNet = codeGenerateNethereumCQSVbNet;
function codeGenerateNethereumCQSFSharp(args, diagnostics, root = null) {
    const lang = 3;
    const editor = vscode.window.activeTextEditor;
    const fileName = editor.document.fileName;
    codeGenerateCQS(fileName, lang, args, diagnostics, root);
}
exports.codeGenerateNethereumCQSFSharp = codeGenerateNethereumCQSFSharp;
function codeGenerateNethereumCQSVbAll(args, diagnostics, root = null) {
    const lang = 1;
    codeGenerateAllFiles(lang, args, diagnostics, root);
}
exports.codeGenerateNethereumCQSVbAll = codeGenerateNethereumCQSVbAll;
function codeGenerateNethereumCQSFSharpAll(args, diagnostics, root = null) {
    const lang = 3;
    codeGenerateAllFiles(lang, args, diagnostics, root);
}
exports.codeGenerateNethereumCQSFSharpAll = codeGenerateNethereumCQSFSharpAll;
function codeGenerateNethereumCQSCSharpAll(args, diagnostics, root = null) {
    const lang = 0;
    codeGenerateAllFiles(lang, args, diagnostics, root);
}
exports.codeGenerateNethereumCQSCSharpAll = codeGenerateNethereumCQSCSharpAll;
function getBuildPath() {
    const packageDefaultDependenciesDirectory = settingsService_1.SettingsService.getPackageDefaultDependenciesDirectories();
    const packageDefaultDependenciesContractsDirectory = settingsService_1.SettingsService.getPackageDefaultDependenciesContractsDirectory();
    const rootPath = workspaceUtil.getCurrentProjectInWorkspaceRootFsPath();
    const remappings = workspaceUtil.getSolidityRemappings();
    const project = (0, projectService_1.initialiseProject)(rootPath, packageDefaultDependenciesDirectory, packageDefaultDependenciesContractsDirectory, remappings);
    return path.join(rootPath, project.projectPackage.build_dir);
}
function codeGenerateAllFiles(lang, args, diagnostics, root = null) {
    const buildPath = getBuildPath();
    const outputPath = '**/*.json';
    const files = vscode.workspace.findFiles(outputPath, null, 1000);
    files.then(documents => {
        documents.forEach(document => {
            if (document.fsPath.startsWith(buildPath)) {
                codeGenerateCQS(document.fsPath, lang, args, diagnostics, root);
            }
        });
    });
}
function codeGenerateAllFilesFromAbiInCurrentFolder(lang, args, diagnostics, root = null) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return; // We need something open
    }
    const buildPath = path.dirname(editor.document.uri.fsPath);
    const outputPath = '**/*.abi';
    const files = vscode.workspace.findFiles(outputPath, null, 1000);
    files.then(documents => {
        documents.forEach(document => {
            if (document.fsPath.startsWith(buildPath)) {
                codeGenerateCQS(document.fsPath, lang, args, diagnostics, root);
            }
        });
    });
}
exports.codeGenerateAllFilesFromAbiInCurrentFolder = codeGenerateAllFilesFromAbiInCurrentFolder;
function getCodeGenerationSettings(root = null) {
    if (root == null) {
        root = workspaceUtil.getCurrentProjectInWorkspaceRootFsPath();
    }
    const settingsFile = path.join(root, 'nethereum-gen.settings');
    if (fs.existsSync(settingsFile)) {
        const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
        return settings;
    }
    return undefined;
}
function getCodeGenerationAbiFilesFromSettings(abisPath) {
    if (path.basename(abisPath) === 'nethereum-gen.abis') {
        if (fs.existsSync(abisPath)) {
            const settings = JSON.parse(fs.readFileSync(abisPath, 'utf8'));
            return settings;
        }
    }
    return undefined;
}
function codeGenerateCQS(fileName, lang, args, diagnostics, root = null) {
    try {
        const extension = getProjectExtensionFromLang(lang);
        if (root == null) {
            root = workspaceUtil.getCurrentProjectInWorkspaceRootFsPath();
        }
        const settings = getCodeGenerationSettings(root);
        const prettyRootName = prettifyRootNameAsNamespace(path.basename(root));
        let baseNamespace = prettyRootName + '.Contracts';
        let projectName = baseNamespace;
        let projectPath = path.join(root);
        let useFolderAsNamespace = false;
        let ignorePrefixFolder = '';
        if (settings !== undefined) {
            if (settings.projectName !== undefined) {
                projectName = settings.projectName;
                baseNamespace = settings.namespace;
            }
            if (settings.projectPath !== undefined) {
                projectPath = path.join(projectPath, settings.projectPath);
            }
            if (settings.useFolderAsNamespace !== undefined) {
                useFolderAsNamespace = settings.useFolderAsNamespace;
            }
            if (settings.ignorePrefixFolder !== undefined) {
                ignorePrefixFolder = settings.ignorePrefixFolder;
            }
        }
        const outputPathInfo = path.parse(fileName);
        const contractName = outputPathInfo.name;
        let compilationOutput;
        let abi = undefined;
        let bytecode = '0x';
        if (outputPathInfo.ext === '.abi') {
            abi = fs.readFileSync(fileName, 'utf8');
            compilationOutput = { 'abi': abi, 'bytecode': '0x' };
            const binFile = fileName.substr(0, fileName.lastIndexOf('.')) + '.bin';
            if (fs.existsSync(binFile)) {
                bytecode = fs.readFileSync(binFile, 'utf8');
            }
        }
        else {
            compilationOutput = JSON.parse(fs.readFileSync(fileName, 'utf8'));
            abi = JSON.stringify(compilationOutput.abi);
            bytecode = compilationOutput.bytecode.object;
            if (bytecode === undefined) {
                bytecode = compilationOutput.bytecode;
            }
        }
        if (abi !== undefined) {
            const projectFullPath = path.join(projectPath, projectName + extension);
            if (!fs.existsSync(projectFullPath)) {
                codegen.generateNetStandardClassLibrary(projectName, projectPath, lang);
            }
            if (useFolderAsNamespace) {
                const pathFullIgnore = path.join(getBuildPath(), ignorePrefixFolder);
                const dirPath = path.dirname(fileName);
                let testPath = '';
                if (dirPath.startsWith(pathFullIgnore)) {
                    testPath = path.relative(pathFullIgnore, path.dirname(fileName));
                    // make upper case the first char in a folder
                    testPath = prettifyRootNameAsNamespaceWithSplitString(testPath, path.sep, path.sep);
                }
                projectPath = path.join(projectPath, testPath);
                const trailingNameSpace = prettifyRootNameAsNamespaceWithSplitString(testPath, path.sep, '.').trim();
                if (trailingNameSpace !== '') {
                    baseNamespace = baseNamespace + '.' + trailingNameSpace;
                }
            }
            codegen.generateAllClasses(abi, bytecode, contractName, baseNamespace, '', '', projectPath, lang);
        }
    }
    catch (e) {
        const outputChannel = outputChannelService_1.OutputChannelService.getInstance().getNethereumCodeGenerationOutputChannel();
        outputChannel.clear();
        outputChannel.appendLine('Error generating code:');
        outputChannel.appendLine(e.message);
        outputChannel.show();
    }
}
exports.codeGenerateCQS = codeGenerateCQS;
// remove - and make upper case
function prettifyRootNameAsNamespace(value) {
    return prettifyRootNameAsNamespaceWithSplitString(value, '-', '');
}
function prettifyRootNameAsNamespaceWithSplitString(value, splitChar, joinChar) {
    return value.split(splitChar).map(function capitalize(part) {
        return part.charAt(0).toUpperCase() + part.slice(1);
    }).join(joinChar);
}
//# sourceMappingURL=codegen.js.map