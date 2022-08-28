import { MonksPlayerSettings, i18n, setting } from "../monks-player-settings.js";

export class MonksSettingsConfig extends SettingsConfig {
    constructor(...args) {
        super(...args);

        this.userId = game.user.id;
    }

    async getData(options) {
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

        const getCategory = category => {
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
        //+++ get the default settings if client settings havn't been saved
        let clientSettings = null;
        if (this.userId != game.user.id) {
            try {
                clientSettings = flattenObject(JSON.parse(game.users.get(this.userId).getFlag('monks-player-settings', 'client-settings') || "{}"));
            } catch { }
        }
        const clientCanConfigure = game.users.get(this.userId).can("SETTINGS_MODIFY");

        // Classify all menus
        for (let menu of gs.menus.values()) {
            if (menu.restricted && !clientCanConfigure) continue;
            const category = getCategory(this._categorizeEntry(menu.namespace));
            category.menus.push(menu);
            total++;
        }

        let gmchanges = {};
        if (game.user.id != this.userId) {
            gmchanges = game.users.get(this.userId).getFlag('monks-player-settings', 'gm-settings') || "{}";
            try {
                gmchanges = JSON.parse(gmchanges);
            } catch {
                gmchanges = {};
            }
        }

        // Classify all settings
        for (let setting of gs.settings.values()) {

            // Exclude settings the user cannot change
            if (!setting.config || (!clientCanConfigure && (setting.scope !== "client"))) continue;

            // Update setting data
            const s = foundry.utils.deepClone(setting);

            let originalValue = (this.userId != game.user.id
                ? this.getClientSetting(s.namespace, s.key, clientSettings)
                : game.settings.get(s.namespace, s.key));

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

            const category = getCategory(this._categorizeEntry(setting.namespace));
            category.settings.push(s);
            total++;
        }

        // Sort categories by priority and assign Counts
        this.clientdata = {};
        for (let category of categories.values()) {
            for (let s of category.settings) {
                if (s.config && s.scope == "client")
                    this.clientdata[s.id] = s.originalValue;
            };
            category.count = category.menus.length + category.settings.length;
        }
        categories = Array.from(categories.values()).sort(this._sortCategories.bind(this));

        this.clientdata = MonksPlayerSettings.cleanSetting(expandObject(this.clientdata));

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
        if (setting.type) {
            if (!(value instanceof setting.type)) {
                if (game.settings.constructor.PRIMITIVE_TYPES.includes(setting.type)) value = setting.type(value);
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

        // if the viewing user has nothing saved yet, warn the GM that they could be overwriting changes made by the player
        let userSaved = (game.users.get(this.userId).flags["monks-player-settings"] !== undefined)
        if (!userSaved)
            ui.notifications.error("Warning: Player has not saved their settings while Monk's Player Settings has been active.  These changes could overwrite some of their settings that you're not intending to change.", { permanent: true });
    }

    async _onSubmit(event, options = {}) {
        //only close if we're looking at oue own data
        options.preventClose = (game.user.id !== this.userId);
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
            let settings = MonksPlayerSettings.cleanSetting(expandObject(duplicate(formData)));
            let diff = diffObject(this.clientdata, settings);

            await game.users.get(this.userId).update({ "flags.monks-player-settings.gm-settings": JSON.stringify(diff) });

            let player = game.users.get(this.userId);
            ui.notifications.info(`Settings have been saved for ${player.name}${!player.active ? " and will be updated the next time the player logs in." : ""}`);
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