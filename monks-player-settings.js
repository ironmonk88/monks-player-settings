import { registerSettings } from "./settings.js";
import { WithMonksSettings } from "./apps/app-settings.js"

export let debug = (...args) => {
    if (debugEnabled > 1) console.log("DEBUG: monks-player-setting | ", ...args);
};
export let log = (...args) => console.log("monks-player-setting | ", ...args);
export let warn = (...args) => {
    if (debugEnabled > 0) console.warn("monks-player-setting | ", ...args);
};
export let error = (...args) => console.error("monks-player-setting | ", ...args);
export let i18n = key => {
    return game.i18n.localize(key);
};
export let setting = key => {
    return game.settings.get("monks-player-setting", key);
};

export class MonksPlayerSettings {
    static init() {

        MonksPlayerSettings.SOCKET = "module.monks-player-setting";

        registerSettings();

        CONFIG.ui.chat = WithMonksSettings(CONFIG.ui.chat);
    }
}

