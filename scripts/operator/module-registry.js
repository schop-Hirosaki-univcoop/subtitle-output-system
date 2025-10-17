import * as Dictionary from "./dictionary.js";
import * as Logs from "./logs.js";
import * as Questions from "./questions.js";
import * as Display from "./display.js";
import * as Dialog from "./dialog.js";
import * as Loader from "./loader.js";

const MODULE_BINDINGS = [
  {
    module: Dictionary,
    methods: {
      fetchDictionary: "fetchDictionary",
      applyInitialDictionaryState: "applyInitialDictionaryState",
      toggleDictionaryDrawer: "toggleDictionaryDrawer",
      addTerm: "addTerm",
      handleDictionaryEdit: "handleDictionaryEdit",
      handleDictionaryEditSubmit: "handleDictionaryEditSubmit",
      closeDictionaryEditDialog: "closeDictionaryEditDialog"
    }
  },
  {
    module: Logs,
    methods: {
      fetchLogs: "fetchLogs",
      renderLogs: "renderLogs",
      applyLogFilters: "applyLogFilters",
      renderLogsStream: "renderLogsStream",
      applyInitialLogsState: "applyInitialLogsState",
      toggleLogsDrawer: "toggleLogsDrawer",
      startLogsUpdateMonitor: "startLogsUpdateMonitor"
    }
  },
  {
    module: Questions,
    methods: {
      renderQuestions: "renderQuestions",
      updateScheduleContext: "updateScheduleContext",
      switchSubTab: "switchSubTab",
      switchGenre: "switchGenre",
      handleDisplay: "handleDisplay",
      handleUnanswer: "handleUnanswer",
      handleSelectAll: "handleSelectAll",
      handleBatchUnanswer: "handleBatchUnanswer",
      clearTelop: "clearTelop",
      updateActionAvailability: "updateActionAvailability",
      updateBatchButtonVisibility: "updateBatchButtonVisibility",
      syncSelectAllState: "syncSelectAllState"
    }
  },
  {
    module: Display,
    methods: {
      handleRenderUpdate: "handleRenderUpdate",
      redrawUpdatedAt: "redrawUpdatedAt",
      refreshStaleness: "refreshStaleness"
    }
  },
  {
    module: Dialog,
    methods: {
      openDialog: "openDialog",
      closeEditDialog: "closeEditDialog",
      handleDialogKeydown: "handleDialogKeydown",
      handleEdit: "handleEdit",
      handleEditSubmit: "handleEditSubmit"
    }
  },
  {
    module: Loader,
    methods: {
      showLoader: "showLoader",
      updateLoader: "updateLoader",
      hideLoader: "hideLoader",
      initLoaderSteps: "initLoaderSteps",
      setLoaderStep: "setLoaderStep",
      finishLoaderSteps: "finishLoaderSteps"
    }
  }
];

export function bindModuleMethods(app) {
  MODULE_BINDINGS.forEach(({ module, methods }) => {
    Object.entries(methods).forEach(([alias, methodName]) => {
      if (typeof module[methodName] !== "function") {
        throw new Error(`Missing method "${methodName}" on module.`);
      }
      Object.defineProperty(app, alias, {
        configurable: true,
        enumerable: false,
        writable: true,
        value: (...args) => module[methodName](app, ...args)
      });
    });
  });
}

export const moduleBindings = MODULE_BINDINGS;
