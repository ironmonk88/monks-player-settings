import { registerSettings } from "./settings.js";
import { MonksSettingsConfig } from "./apps/settings-config.js"

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
                if (!this._sheet) this._sheet = new MonksSettingsConfig();
                return this._sheet;
            }
        })
    }

    static async ready() {
        if (game.user.data.flags == undefined || game.user.data.flags['monks-player-settings'] == undefined)
            MonksPlayerSettings.saveSettings(); //save what I've got

        MonksPlayerSettings.checkSettings();
    }

    static async saveSettings() {
        let clientSettings = this.cleanSetting(expandObject(duplicate(game.settings.storage.get("client"))));
        await game.user.setFlag('monks-player-settings', 'client-settings', JSON.stringify(clientSettings));
    }

    static cleanSetting(settings) {
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
                        }
                    }
                }
                if (Object.keys(settings[module]).length === 0)
                    delete settings[module];
            } else
                delete settings[module];
        }

        return settings;
    }

    static async checkSettings() {
        let refresh = false;

        //if there are differences in the stored settings request to sync
        let client = this.cleanSetting(expandObject(duplicate(game.settings.storage.get("client")) || {}));
        let stored = game.user.getFlag('monks-player-settings', 'client-settings');
        if (stored !== undefined) {
            try {
                stored = JSON.parse(stored);
            } catch {
                stored = null;
            }
            stored = this.cleanSetting(duplicate(stored || {}));
            let diff = diffObject(client, stored);

            if (!isObjectEmpty(diff)) {
                await Dialog.confirm({
                    title: `Data Sync`,
                    content: `<h4>Difference in client settings detected</h4><p>Would you like to sync your current account with the saved settings?</p>`,
                    yes: () => {
                        for (let [namespace, values] of Object.entries(diff)) {
                            for (let [k, v] of Object.entries(values)) {
                                let key = `${namespace}.${k}`;
                                window.localStorage.setItem(key, v);

                                console.log(`Setting Sync: ${key}, "${client[namespace][k]}" -> "${v}"`);

                                //do any of the differences call a function?  Then refresh the browser
                                const setting = game.settings.settings.get(key);
                                if (setting.onChange instanceof Function) refresh = true;
                            }
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
