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
exports.OutputChannelService = void 0;
const vscode = __importStar(require("vscode"));
class OutputChannelService {
    // Get the singleton instance of the OutputChannelService
    static getInstance() {
        if (!this.instance) {
            this.instance = new OutputChannelService();
        }
        return this.instance;
    }
    getNethereumCodeGenerationOutputChannel() {
        return this.nethereumCodeGenerationOuputChannel;
    }
    getSolidityCompilerOutputChannel() {
        return this.solidityCompilerOutputChannel;
    }
    // Method to dispose of the output channel (useful during extension deactivation)
    dispose() {
        if (this.nethereumCodeGenerationOuputChannel) {
            this.nethereumCodeGenerationOuputChannel.dispose();
            OutputChannelService.instance = null; // Reset instance for future usage if needed
        }
    }
    // Private constructor to prevent direct instantiation
    constructor() {
        // Create the output channel upon instantiation
        this.nethereumCodeGenerationOuputChannel = vscode.window.createOutputChannel('Nethereum Code Generation');
        this.solidityCompilerOutputChannel = vscode.window.createOutputChannel('Solidity Compiler');
    }
}
// Singleton instance
OutputChannelService.instance = null;
exports.OutputChannelService = OutputChannelService;
//# sourceMappingURL=outputChannelService.js.map