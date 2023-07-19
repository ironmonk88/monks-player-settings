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
    static PRIMITIVE_TYPES = [String, Number, Boolean, Array, Symbol, BigInt];

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

    static cleanSetting(settings) {
        //delete settings.core;
        //delete settings[game.system.id];
        delete settings["monks-player-settings"];

        const deleteSetting = (settings, key) => {
            try {
                delete settings[key];
            } catch (err) {
                log(err);
            }
        };

        // Recursively make our way down the object. At each level, if we can't find
        // the setting using the supplied key, but our current value is an object,
        // then check each of the sub-keys, appending the new key to the current key
        // each time.
        // If we find a setting for the key, but the setting doesn't appear in the
        // settings menu, or it's set to its default, then clean it up
        const cleanSettings = (keyPrefix, value) => {
            for (let [subKey, subValue] of Object.entries(value)) {
                const key = keyPrefix ? `${keyPrefix}.${subKey}` : subKey;
                const setting = game.settings.settings.get(key);

                if (!setting) {
                    if (typeof subValue === "object") {
                        cleanSettings(key, subValue);

                        // If we've removed all the sub-keys keys, then remove the sub-key
                        if (Object.keys(value[subKey]).length === 0) {
                            deleteSetting(value, subKey);
                        }
                    } else {
                        deleteSetting(value, subKey)
                    }
                } else if (!setting.config) {
                    deleteSetting(value, subKey);
                } else if (String(setting.default) === String(subValue)) {
                    deleteSetting(value, subKey);
                }
            }
        };
        cleanSettings(null, settings);

        return settings;
    }

    static mergeDefaults(settings) {
        let defaults = {};
        let exclude = ["monks-player-settings"];
        for (let setting of game.settings.settings.values()) {
            if (setting.scope === "client" && setting.config && MonksPlayerSettings.PRIMITIVE_TYPES.includes(setting.type) && !exclude.includes(setting.namespace)) {
                let key = `${setting.namespace}.${setting.key}`;
                defaults[key] = setting.default;
            }
        }

        return mergeObject(expandObject(defaults), settings);
    }

    static makeReadable(diff = {}) {
        let result = [];

        let client = game.settings.storage.get("client");

        for (let [moduleId, changes] of Object.entries(diff)) {
            let title = moduleId === "core" ? "Core" : game.modules.get(moduleId)?.title;
            let data = { id: moduleId, name: title, changes: [] };

            this.findSettings(client, data, moduleId, null, changes);

            result.push(data);
        }

        return result;
    }

    static findSettings(client, data, moduleId, keyPrefix, changes) {
        for (let [settingId, value] of Object.entries(changes)) {
            let key = keyPrefix ? `${keyPrefix}.${settingId}` : settingId;
            let fullKey = `${moduleId}.${key}`;

            let config = game.settings.settings.get(fullKey);
            if (!config && typeof value === "object") {
                // If we didn't config the config but the type is an object, maybe it's a nested setting
                this.findSettings(client, data, moduleId, key, value);
            } else {
                let oldvalue = client[fullKey];
                let newvalue = value;

                if (typeof oldvalue == "object") {
                    try { oldvalue = JSON.stringify(oldvalue); } catch {}
                }

                if (typeof newvalue == "object") {
                    try { newvalue = JSON.stringify(newvalue); } catch {}
                }

                data.changes.push({ id: key, name: i18n(config.name), oldvalue: oldvalue, newvalue: newvalue, use: 'newvalue' });
            }
        }
    }

    static getDifferences() {
        //if there are differences in the stored settings request to sync
        let client = this.mergeDefaults(this.cleanSetting(expandObject(duplicate(game.settings.storage.get("client")) || {})));
        let stored = game.user.getFlag('monks-player-settings', 'client-settings');
        if (stored !== undefined) {
            try {
                stored = JSON.parse(stored);
            } catch {
                stored = null;
            }
            stored = this.mergeDefaults(this.cleanSetting(duplicate(stored || {})));
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
            let diff = {};
            let storedChanged = false;
            let client = this.mergeDefaults(this.cleanSetting(expandObject(duplicate(game.settings.storage.get("client")) || {})));
            let stored = game.user.getFlag('monks-player-settings', 'client-settings');
            if (stored !== undefined) {
                try {
                    stored = JSON.parse(stored);
                } catch {
                    stored = null;
                }
                stored = this.mergeDefaults(this.cleanSetting(duplicate(stored || {})));
                //also need to add all the defaults so that the diff picks up on thos changes
                diff = diffObject(client, stored);
            }

            let data = this.makeReadable(diff);

            if (!isEmpty(diff)) {
                let content = await renderTemplate("./modules/monks-player-settings/templates/differences.html", { differences: data });
                await Dialog.wait({
                    title: `Data Sync`,
                    content: content,
                    buttons: {
                        yes: {
                            icon: '<i class="fas fa-check"></i>',
                            label: game.i18n.localize("Yes"),
                            callback: () => {
                                for (let module of data) {
                                    for (let change of module.changes) {
                                        let key = `${module.id}.${change.id}`;
                                        if (change.use == "newvalue" || change.use == "oldvalue") {
                                            let value = change[change.use];
                                            log(`Setting Sync: ${key}, "${window.localStorage[key]}" -> "${value}"`);

                                            if (change.use == "newvalue") {
                                                window.localStorage.setItem(key, value);

                                                //do any of the differences call a function?  Then refresh the browser
                                                const setting = game.settings.settings.get(key);
                                                if (setting?.onChange instanceof Function) refresh = true;
                                            } else {
                                                // If the setting is nested, then we should keep that structure in the store
                                                // as that's the format we extract it. Recurse into the store creating the structure
                                                const keys = key.split(".");
                                                const storeSetting = (obj, keys, value) => {
                                                    let key = keys.shift();
                                                    if (!keys.length) {
                                                        // We've reached the last key, which means we can just store our value
                                                        obj[key] = value;
                                                    } else {
                                                        // Our key is nested further down, so create an empty object on this level
                                                        // (if there isn't already one) with this key's name, and then recurse down
                                                        obj[key] ??= {};
                                                        storeSetting(obj[key], keys, value);
                                                    }
                                                };
                                                storeSetting(stored, keys, value);
                                                storedChanged = true;
                                            }
                                        } else
                                            log(`Setting Sync: Ignoring ${key}`);
                                    }
                                }
                            }
                        },
                        ignore: {
                            label: "Ignore",
                            callback: () => {
                                let saveId = game.user.getFlag('monks-player-settings', 'save-id') || 0;
                                game.user.setFlag('monks-player-settings', 'ignore-id', saveId);
                            }
                        },
                        no: {
                            icon: '<i class="fas fa-times"></i>',
                            label: game.i18n.localize("No")
                        },
                    },
                    render: (html) => {
                        $('.setting-oldvalue,.setting-newvalue', html).on("click", (ev) => {
                            let use = ev.currentTarget.dataset.use;
                            let li = ev.currentTarget.closest(".setting-group");
                            let id = li.dataset.id;
                            let settingId = li.dataset.setting;

                            let item = data.find(i => i.id == id);
                            if (item) {
                                let setting = item.changes.find(s => s.id == settingId);
                                if (setting) {
                                    setting.use = setting.use == use ? "none" : use;
                                    $('.setting-oldvalue', li).toggleClass("active", setting.use == "oldvalue");
                                    $('.setting-newvalue', li).toggleClass("active", setting.use == "newvalue");
                                    $('.setting-direction i', li).attr("class", `fas ${setting.use == "oldvalue" ? "fa-chevron-left" : (setting.use == "newvalue" ? "fa-chevron-right" : "fa-not-equal")}`);
                                }
                            }
                        })
                    },
                    close: () => { return true; }
                }, { width: "600" });

                if (storedChanged) {
                    game.user.setFlag('monks-player-settings', 'client-settings', JSON.stringify(stored));
                }
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
            if (Object.keys(gmsettings).length == 0) {
                game.user.unsetFlag('monks-player-settings', 'gm-settings');
                return;
            }

            const setStorage = (key, value) => {
                const setting = game.settings.settings.get(key);
                if (!setting && typeof value === "object") {
                    for (let [subKey, subValue] of Object.entries(value)) {
                        setStorage(key ? `${key}.${subKey}` : subKey, subValue);
                    }
                } else {
                    window.localStorage.setItem(key, value);
                    console.log(`GM Update Setting: ${key}, "${value}"`);

                    if (setting?.onChange instanceof Function) refresh = true;
                }    
            };
            setStorage("", gmsettings);

            //clear the gm setting changes
            await game.user.unsetFlag('monks-player-settings', 'gm-settings');

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
        console.log('updating user', user, data, options);
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
