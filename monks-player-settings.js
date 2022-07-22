import { registerSettings } from "./settings.js";
import { WithMonksSettingsConfig, MonksSettingsConfig } from "./apps/settings-config.js"

export let debugEnabled = 0;

export let debug = (...args) => {
    if (debugEnabled > 1) console.log("DEBUG: monks-player-settings | ", ...args);
};
export let log = (...args) => console.log("monks-player-settings | ", ...args);
export let warn = (...args) => {
    if (debugEnabled > 0) console.warn("monks-player-settings | ", ...args);
};
export let error = (...args) => console.error("monks-player-settings | ", ...args);
export let i18n = key => {
    return game.i18n.localize(key);
};
export let setting = key => {
    return game.settings.get("monks-player-settings", key);
};

export class MonksPlayerSettings {
    static init() {

        MonksPlayerSettings.SOCKET = "module.monks-player-settings";

        registerSettings();

        Object.defineProperty(ClientSettings.prototype, "sheet", {
            get: function () {
                if (!this._sheet) {
                    let settingCls = WithMonksSettingsConfig(game.settings._sheet?.constructor || SettingsConfig);
                    this._sheet = new settingCls();
                }
                return this._sheet;
            }
        })
    }

    static async ready() {
        if (game.modules.get("settings-extender")?.active) {
            let settingCls = WithMonksSettingsConfig(game.settings._sheet?.constructor || SettingsConfig);
            game.settings._sheet = new settingCls(game.settings.settings);

            window.setTimeout(() => {
                if (!(game.settings._sheet instanceof MonksSettingsConfig)) {
                    let settingCls = WithMonksSettingsConfig(game.settings._sheet?.constructor || SettingsConfig);
                    game.settings._sheet = new settingCls(game.settings.settings);
                }
            }, 500);
        }

        if (game.user.flags == undefined || game.user.flags['monks-player-settings'] == undefined)
            MonksPlayerSettings.saveSettings(); //save what I've got

        MonksPlayerSettings.checkSettings();
    }

    static async saveSettings() {
        let clientSettings = this.cleanSetting(expandObject(duplicate(game.settings.storage.get("client"))));
        await game.user.setFlag('monks-player-settings', 'client-settings', JSON.stringify(clientSettings));

        let saveId = game.user.getFlag('monks-player-settings', 'save-id') || 0;
        game.user.setFlag('monks-player-settings', 'save-id', ++saveId);
    }

    static cleanSetting(settings, defObject = {}) {
        delete settings.core;
        delete settings[game.system.id];
        delete settings["monks-player-settings"];

        for (let [module, s] of Object.entries(settings)) {
            if (typeof s === "object") {
                for (let [name, value] of Object.entries(s)) {
                    let key = `${module}.${name}`;
                    let config = game.settings.settings.get(key);
                    if (!config || !config.config) {
                        try {
                            delete s[name];
                        } catch (err) {
                            log(err);
                        }
                    } else {
                        try {
                            value = JSON.parse(value);
                        } catch (err) {
                            value = String(value);
                        }
                        if (config.default == value) {
                            try {
                                delete s[name];
                            } catch (err) {
                                log(err);
                            }
                        } else
                            defObject[key] = config.default;
                    }
                }
                if (Object.keys(settings[module]).length === 0)
                    delete settings[module];
            } else
                delete settings[module];
        }

        return settings;
    }

    static makeReadable(diff = {}) {
        let result = [];

        let client = game.settings.storage.get("client");

        for (let [moduleId, changes] of Object.entries(diff)) {
            let module = game.modules.get(moduleId);
            let data = { id: moduleId, name: module.title, changes: [] };

            for (let [settingId, value] of Object.entries(changes)) {
                let key = `${moduleId}.${settingId}`;
                let config = game.settings.settings.get(key);

                let oldValue = client[key];
                let newValue = value;

                if (typeof oldValue == "object") {
                    try { oldValue = JSON.stringify(oldValue) } catch { }
                }

                if (typeof newValue == "object") {
                    try { newValue = JSON.stringify(newValue) } catch { }
                }

                data.changes.push({ id: settingId, name: i18n(config.name), oldValue: oldValue, newValue: newValue});
            }

            result.push(data);
        }

        return result;
    }

    static getDifferences() {
        //if there are differences in the stored settings request to sync
        let defSettings = {};
        let client = this.cleanSetting(expandObject(duplicate(game.settings.storage.get("client")) || {}), defSettings);
        let stored = game.user.getFlag('monks-player-settings', 'client-settings');
        if (stored !== undefined) {
            try {
                stored = JSON.parse(stored);
            } catch {
                stored = null;
            }
            stored = mergeObject(expandObject(defSettings), this.cleanSetting(duplicate(stored || {})));
            //also need to add all the defaults so that the diff picks up on thos changes
            return diffObject(client, stored);
        }

        return {};
    }

    static ignoreChanges() {
        let saveId = game.user.getFlag('monks-player-settings', 'save-id') || 0;
        let ignoreId = game.user.getFlag('monks-player-settings', 'ignore-id');

        return !(ignoreId == undefined || saveId > ignoreId);
    }

    static async checkSettings() {
        let refresh = false;

        if (setting("sync-settings") && !this.ignoreChanges()) {
            //if there are differences in the stored settings request to sync
            let diff = this.getDifferences();

            if (!isEmpty(diff)) {
                let content = await renderTemplate("./modules/monks-player-settings/templates/differences.html", { differences: this.makeReadable(diff) });
                await Dialog.confirm({
                    title: `Data Sync`,
                    content: content,
                    yes: () => {
                        for (let [namespace, values] of Object.entries(diff)) {
                            for (let [k, v] of Object.entries(values)) {
                                let key = `${namespace}.${k}`;

                                console.log(`Setting Sync: ${key}, "${window.localStorage[key]}" -> "${v}"`);

                                window.localStorage.setItem(key, v);

                                //do any of the differences call a function?  Then refresh the browser
                                const setting = game.settings.settings.get(key);
                                if (setting.onChange instanceof Function) refresh = true;
                            }
                        }
                    },
                    no: (html) => {
                        //ignore until the next sync changes?
                        if ($('.ignore', html).prop("checked")) {
                            let saveId = game.user.getFlag('monks-player-settings', 'save-id') || 0;
                            game.user.setFlag('monks-player-settings', 'ignore-id', saveId);
                        }
                    }
                });
            }
        }

        //check to see if there are GM changes
        //and if the webpage needs to be refreshed
        if (await MonksPlayerSettings.refreshSettings() || refresh)
            MonksPlayerSettings.checkRefresh();
    }

    static async refreshSettings() {
        let refresh = false;

        //if there are GM changes then prompt to update with those changes
        if (game.user.getFlag('monks-player-settings', 'gm-settings') != undefined) {
            let gmsettings = game.user.getFlag('monks-player-settings', 'gm-settings');
            try {
                gmsettings = JSON.parse(gmsettings);
            } catch {
                gmsettings = {};
            }
            for (let [namespace, values] of Object.entries(gmsettings)) {
                for (let [k, v] of Object.entries(values)) {
                    let key = `${namespace}.${k}`;
                    window.localStorage.setItem(key, v);

                    console.log(`GM Update Setting: ${key}, "${v}"`);

                    //if the webpage needs to be refreshed then return true
                    const setting = game.settings.settings.get(key);
                    if (setting.onChange instanceof Function) refresh = true;
                }
            }

            //clear the gm setting changes
            game.user.unsetFlag('monks-player-settings', 'gm-settings');

            //save a new copy of the client settings
            let clientSettings = this.cleanSetting(expandObject(duplicate(game.settings.storage.get("client"))));
            await game.user.setFlag('monks-player-settings', 'client-settings', JSON.stringify(clientSettings));

            ui.notifications.info("GM has made changes to your client settings");
        }

        return refresh;
    }

    static checkRefresh() {
        Dialog.confirm({
            title: `Browser refresh`,
            content: `<h4>Some of the settings changed required Foundry to be restarted</h4><p>Reload the browser?</p>`,
            yes: () => {
                location.reload();
            }
        });
    }
}

Hooks.once('init', async function () {
    MonksPlayerSettings.init();
});

Hooks.once('ready', async function () {
    MonksPlayerSettings.ready();
});

Hooks.on('updateUser', async function (user, data, options) {
    console.log('updating user', user, data, options);
    //If the GM has changed settings and the player is currently active, then refresh settings
    if (data.flags && data.flags["monks-player-settings"] && data.flags["monks-player-settings"]["gm-settings"]) {
        if (await MonksPlayerSettings.refreshSettings())
            MonksPlayerSettings.checkRefresh();
    }

    //if this is the GM then update to match changes player made
    if (game.user.isGM
        && data.flags
        && data.flags["monks-player-settings"]
        && data.flags["monks-player-settings"]["client-settings"]
        && $('#client-settings').length
        && $('#client-settings .viewed-user').val() == user.id)
    {
        try {
            let settings = JSON.parse(data.flags["monks-player-settings"]["client-settings"]);
            for (let [k, v] of Object.entries(settings)) {
                for (let [name, value] of Object.entries(v)) {
                    let key = `${k}.${name}`;
                    let val = value;
                    try {
                        val = JSON.parse(val);
                    } catch (err) {
                        val = String(val);
                    }
                    if (typeof val == "boolean")
                        $(`#client-settings [name="${key}"]`).prop("checked", val);
                    else
                        $(`#client-settings [name="${key}"]`).val(val);
                }
            }
        } catch {}
    }
});
