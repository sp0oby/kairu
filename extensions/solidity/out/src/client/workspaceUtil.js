"use strict";
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
exports.getSolidityRemappings = exports.getCurrentWorkspaceRootFolder = exports.getCurrentWorkspaceRootFsPath = exports.getCurrentProjectInWorkspaceRootFsPath = void 0;
const vscode = __importStar(require("vscode"));
const util_1 = require("../common/util");
const projectService_1 = require("../common/projectService");
const settingsService_1 = require("./settingsService");
function getCurrentProjectInWorkspaceRootFsPath() {
    const monoreposupport = settingsService_1.SettingsService.getMonoRepoSupport();
    const currentRootPath = getCurrentWorkspaceRootFsPath();
    if (monoreposupport) {
        const editor = vscode.window.activeTextEditor;
        const currentDocument = editor.document.uri;
        const projectFolder = (0, projectService_1.findFirstRootProjectFile)(currentRootPath, currentDocument.fsPath);
        if (projectFolder == null) {
            return currentRootPath;
        }
        else {
            return projectFolder;
        }
    }
    else {
        return currentRootPath;
    }
}
exports.getCurrentProjectInWorkspaceRootFsPath = getCurrentProjectInWorkspaceRootFsPath;
function getCurrentWorkspaceRootFsPath() {
    var _a, _b;
    return (_b = (_a = getCurrentWorkspaceRootFolder()) === null || _a === void 0 ? void 0 : _a.uri) === null || _b === void 0 ? void 0 : _b.fsPath;
}
exports.getCurrentWorkspaceRootFsPath = getCurrentWorkspaceRootFsPath;
function getCurrentWorkspaceRootFolder() {
    var _a, _b, _c, _d;
    //  Try active editor
    const activeUri = (_b = (_a = vscode.window.activeTextEditor) === null || _a === void 0 ? void 0 : _a.document) === null || _b === void 0 ? void 0 : _b.uri;
    if (activeUri) {
        const folder = vscode.workspace.getWorkspaceFolder(activeUri);
        if (folder) {
            return folder;
        }
    }
    // Try first visible editor
    const visibleUri = (_d = (_c = vscode.window.visibleTextEditors[0]) === null || _c === void 0 ? void 0 : _c.document) === null || _d === void 0 ? void 0 : _d.uri;
    if (visibleUri) {
        const folder = vscode.workspace.getWorkspaceFolder(visibleUri);
        if (folder) {
            return folder;
        }
    }
    // Try workspace folders
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
        return folders[0];
    }
    return undefined;
}
exports.getCurrentWorkspaceRootFolder = getCurrentWorkspaceRootFolder;
function getSolidityRemappings() {
    const remappings = settingsService_1.SettingsService.getRemappings();
    if (process.platform === 'win32') {
        return (0, util_1.replaceRemappings)(remappings, settingsService_1.SettingsService.getRemappingsWindows());
    }
    else {
        return (0, util_1.replaceRemappings)(remappings, settingsService_1.SettingsService.getRemappingsUnix());
    }
}
exports.getSolidityRemappings = getSolidityRemappings;
//# sourceMappingURL=workspaceUtil.js.map