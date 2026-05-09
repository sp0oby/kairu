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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const { parentPort } = require('worker_threads');
parentPort.on('message', (task) => __awaiter(this, void 0, void 0, function* () {
    try {
        // Dynamically import prettier
        const prettier = yield Promise.resolve(`${task.prettierPath}`).then(s => __importStar(require(s)));
        // Resolve config
        const config = yield prettier.resolveConfig(task.documentPath);
        if (config !== null) {
            yield prettier.clearConfigCache();
        }
        // Merge user config with default options
        const options = Object.assign(Object.assign(Object.assign({}, task.options), config), { plugins: [task.pluginPath] });
        const formatted = yield prettier.format(task.source, options);
        parentPort.postMessage({ success: true, formatted });
    }
    catch (error) {
        parentPort.postMessage({ success: false, error: error.message });
    }
}));
//# sourceMappingURL=formatterPrettierWorker.js.map