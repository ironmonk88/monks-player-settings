import { MonksPlayerSettings, i18n, setting, log } from "../monks-player-settings.js";

export class MonksSettingsConfig extends SettingsConfig {
    constructor(...args) {
        super(...args);

        this.userId = game.user.id;
    }

    async getData(options) {
        if (game.user.isGM) {
            this.clientSettings = {};
            this.gmchanges = {};

            let users = game.users.filter(u => u.id != game.user.id);

            for (let user of users) {
                try {
                    let cs = foundry.utils.getProperty(user, "flags.monks-player-settings.client-settings");
                    this.clientSettings[user.id] = cs ? foundry.utils.flattenObject(JSON.parse(cs)) : null;
                    this.gmchanges[user.id] = JSON.parse(foundry.utils.getProperty(user, "flags.monks-player-settings.gm-settings") || "{}");
                } catch { }
            }

            this.gmchanges["players"] = JSON.parse(foundry.utils.getProperty(game.user, "flags.monks-player-settings.players-settings") || "{}");
        }

        let data = await super.getData(options);
        data.user = game.users.get(this.userId);

        return data;
    }

    _prepareCategoryData() {
        if (!game.user.isGM)
            return super._prepareCategoryData();

        const gs = game.settings;
        const canConfigure = game.user.can("SETTINGS_MODIFY");
        let categories = new Map();
        let total = 0;

        const getCategory = (category) => {
            let cat = categories.get(category.id);
            if (!cat) {
                cat = {
                    id: category.id,
                    title: category.title,
                    menus: [],
                    settings: [],
                    count: 0
                };
                categories.set(category.id, cat);
            }
            return cat;
        };

        //find the settings of the users we're currently looking at
        this.clientdata = {};
        let clientSettings = this.userId != game.user.id ? this.clientSettings[this.userId] || {} : {};
        let gmchanges = this.userId != game.user.id ? this.gmchanges[this.userId] || {} : {};

        const clientCanConfigure = this.userId == "players" ? false : game.users.get(this.userId).can("SETTINGS_MODIFY");

        let ignoreModules = MonksPlayerSettings.getExcludeModules();

        // Classify all menus
        for (let menu of gs.menus.values()) {
            // Exclude the setting from modules that are ignored
            if (this.userId != game.user.id && ignoreModules.includes(menu.namespace)) continue;

            if (menu.restricted && !clientCanConfigure) continue;
            const category = getCategory(this._categorizeEntry(menu.namespace));
            category.menus.push(menu);
            total++;
        }

        // Classify all settings
        for (let setting of gs.settings.values()) {
            // Exclude the setting from modules that are ignored
            if (this.userId != game.user.id && ignoreModules.includes(setting.namespace)) continue;

            // Exclude settings the user cannot change
            if (!setting.config || (!clientCanConfigure && (setting.scope !== "client"))) continue;

            // Update setting data
            const s = foundry.utils.deepClone(setting);

            let originalValue;
            try {
                originalValue = (this.userId != game.user.id ? this.getClientSetting(s.namespace, s.key, clientSettings) : game.settings.get(s.namespace, s.key));
            } catch (err) {
                log(`Settings detected issue ${s.namespace}.${s.key}`, err);
            }

            s.id = `${s.namespace}.${s.key}`;
            s.name = game.i18n.localize(s.name);
            s.hint = game.i18n.localize(s.hint);
            s.value = (this.userId != game.user.id ? (gmchanges[s.namespace] && gmchanges[s.namespace][s.key]) ?? originalValue : originalValue);
            s.originalValue = originalValue;
            s.type = setting.type instanceof Function ? setting.type.name : "String";
            s.isCheckbox = setting.type === Boolean;
            s.isSelect = s.choices !== undefined;
            s.isRange = (setting.type === Number) && s.range;
            s.isNumber = setting.type === Number;
            s.filePickerType = s.filePicker === true ? "any" : s.filePicker;
            s.dataField = setting.type instanceof foundry.data.fields.DataField ? setting.type : null;
            s.input = setting.input;

            if (s.config && s.scope == "client")
                this.clientdata[s.id] = s.originalValue;

            const category = getCategory(this._categorizeEntry(setting.namespace));
            category.settings.push(s);
            total++;
        }

        // Sort categories by priority and assign Counts
        for (let category of categories.values()) {
            category.count = category.menus.length + category.settings.length;
        }
        categories = Array.from(categories.values()).sort(this._sortCategories.bind(this));

        this.clientdata = MonksPlayerSettings.mergeDefaults(MonksPlayerSettings.cleanSetting(foundry.utils.expandObject(this.clientdata)));

        return { categories, total, user: game.user, canConfigure };
    }

    getClientSetting(namespace, key, storage = {}) {
        if (!game.user.isGM)
            return super.getClientSetting(namespace, key, storage);

        if (!namespace || !key) throw new Error("You must specify both namespace and key portions of the setting");
        key = `${namespace}.${key}`;
        if (!game.settings.settings.has(key)) throw new Error("This is not a registered game setting");

        // Get the setting and the correct storage interface
        const setting = game.settings.settings.get(key);

        // Get the setting value
        let value = storage[key];
        if (value) {
            try {
                value = JSON.parse(value);
            } catch (err) {
                value = String(value);
            }
        }
        else value = (setting.default || "");

        // Cast the value to a requested type
        if (setting.type && MonksPlayerSettings.PRIMITIVE_TYPES.includes(setting.type)) {
            if (!(value instanceof setting.type)) {
                if (MonksPlayerSettings.PRIMITIVE_TYPES.includes(setting.type)) value = setting.type(value);
                else {
                    const isConstructed = setting.type?.prototype?.constructor === setting.type;
                    value = isConstructed ? new setting.type(value) : setting.type(value);
                }
            }
        }
        return value;
    }

    async changeUserSettings(ev) {
        if (!game.user.isGM)
            return super.changeUserSettings(ev);

        this.userId = $(ev.currentTarget).val();

        this.render();

        if (this.userId != "players") {
            // if the viewing user has nothing saved yet, warn the GM that they could be overwriting changes made by the player
            let userSaved = (game.users.get(this.userId).flags["monks-player-settings"] !== undefined)
            if (!userSaved)
                ui.notifications.error("Warning: Player has not saved their settings while Monk's Player Settings has been active.  These changes could overwrite some of their settings that you're not intending to change.", { permanent: true });
        }
    }

    async _onSubmit(event, options = {}) {
        //only close if we're looking at oue own data
        options.preventClose = (game.user.id !== this.userId) || options.preventClose;
        return super._onSubmit.call(this, event, options);
    }

    async _updateObject(event, formData) {
        if (game.user.id == this.userId) {
            //this is just a regular update
            await super._updateObject(event, formData);

            //save a copy of the client settings to user data
            if (setting("sync-settings"))
                MonksPlayerSettings.saveSettings();
        } else {
            // Need to compare the formData with the client values
            let settings = MonksPlayerSettings.mergeDefaults(MonksPlayerSettings.cleanSetting(foundry.utils.expandObject(foundry.utils.duplicate(formData))));
            
            if (this.userId == "players") {
                let gameSettings = [...game.settings.settings].filter(([k, v]) => v.config && v.scope == "client").map(([k, v]) => v);

                let diff = foundry.utils.diffObject(this.clientdata, settings);
                await game.user.update({ "flags.monks-player-settings.players-settings": JSON.stringify(diff) });

                for (let user of game.users.filter(u => !u.isGM)) {
                    let clientSettings = this.clientSettings[user.id];
                    let clientData = {};

                    if (clientSettings) {
                        for (let s of gameSettings) {
                            let originalValue;
                            try {
                                originalValue = this.getClientSetting(s.namespace, s.key, clientSettings);
                            } catch (err) {
                                log(`Settings detected issue ${s.namespace}.${s.key}`, err);
                            }
                            clientData[`${s.namespace}.${s.key}`] = originalValue;
                        }
                        clientData = MonksPlayerSettings.cleanSetting(foundry.utils.expandObject(clientData));
                    } else
                        clientData = this.clientdata;
                    
                    let diff = foundry.utils.diffObject(clientData, settings);

                    await user.update({ "flags.monks-player-settings.gm-settings": JSON.stringify(diff) });
                }
                ui.notifications.info(`Settings have been saved for all players and will be updated the next time each player logs in.`);
            } else {
                let diff = foundry.utils.diffObject(this.clientdata, settings);
                if (Object.keys(diff).length) {
                    await game.users.get(this.userId).update({ "flags.monks-player-settings.gm-settings": JSON.stringify(diff) });

                    let player = game.users.get(this.userId);
                    ui.notifications.info(`Settings have been saved for ${player.name}${!player.active ? " and will be updated the next time the player logs in." : ""}`);
                } else {
                    let player = game.users.get(this.userId);
                    ui.notifications.info(`No settings have been changed for ${player.name}`);
                }
            }
        }
    }

    async close(options) {
        this.userId = game.user.id;
        return super.close(options);
    }
}

export const WithMonksSettingsConfig = (SettingsConfig) => {
    const constructorName = "MonksSettingsConfig";
    Object.defineProperty(MonksSettingsConfig.prototype.constructor, "name", { value: constructorName });
    return MonksSettingsConfig;
};

Hooks.on('renderSettingsConfig', (app, html) => {
    if (game.user.isGM) {
        let userId = (app.userId || game.user.id);

        let select = $('<select>')
            .addClass("viewed-user")
            .append('<option value="players">-- All Players --</option>')
            .append(game.users.map(u => { return `<option value="${u.id}"${u.id == userId ? ' selected' : ''}>${u.name}</option>` }))
            .on('change', app.changeUserSettings.bind(app));

        let div = $('<div>')
            .attr("id", "mps-view-group")
            .addClass('flexrow')
            .append($('<label>').html('View settings for Player:'))
            .append($('<div>').addClass('form-fields').append(select));

        if ($('.window-content', html).length)
            $('.window-content', html).prepend(div);
        else
            div.insertBefore(html);

    }
})