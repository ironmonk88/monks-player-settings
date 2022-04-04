import { MonksPlayerSettings, i18n, setting } from "../monks-player-settings.js";

export class MonksSettingsConfig extends SettingsConfig {
    constructor(...args) {
        super(...args);

        this.userId = game.user.id;
    }

    getData(options) {
        const gs = game.settings;
        const canConfigure = game.user.can("SETTINGS_MODIFY");

        // Set-up placeholder structure for core, system, and module settings
        const data = {
            core: { version: game.version, menus: [], settings: [] },
            system: { title: game.system.data.title, menus: [], settings: [] },
            modules: {}
        };

        // Register a module the first time it is seen
        const registerModule = name => {
            const module = game.modules.get(name);
            data.modules[name] = { title: module ? module.data.title : "General Module Settings", menus: [], settings: [] };
        };

        //find the settings of the users we're currently looking at
        //+++ get the default settings if client settings havn't been saved
        const clientSettings = (this.userId != game.user.id ? game.users.get(this.userId).getFlag('monks-player-settings', 'client-settings') : null);
        const clientCanConfigure = game.users.get(this.userId).can("SETTINGS_MODIFY");

        // Classify all menus
        for (let menu of gs.menus.values()) {
            if (menu.restricted && !clientCanConfigure) continue;
            if (menu.namespace === "core") {
                data.core.menus.push(menu);
            }
            else if (menu.namespace === game.system.id) {
                data.system.menus.push(menu);
            }
            else {
                const name = menu.namespace || "module";
                if (!data.modules[name]) registerModule(name);
                data.modules[name].menus.push(menu);
            }
        }

        let gmchanges = {};
        if (game.user.id != this.userId) {
            gmchanges = game.users.get(this.userId).getFlag('monks-player-settings', 'gm-settings') || {};
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
            s.filePickerType = s.filePicker === true ? "folder" : s.filePicker;

            // Classify setting
            const name = s.namespace;
            if (name === "core") data.core.settings.push(s);
            else if (name === game.system.id) data.system.settings.push(s);
            else {
                if (!data.modules[name]) registerModule(name);
                data.modules[name].settings.push(s);
            }
        }

        // Sort Module headings by name
        data.modules = Object.values(data.modules).sort((a, b) => a.title.localeCompare(b.title));

        // Flag categories that have nothing
        data.core.none = (data.core.menus.length + data.core.settings.length) === 0;
        data.system.none = (data.system.menus.length + data.system.settings.length) === 0;

        this.clientdata = {};
        for (let m of data.modules) {
            for (let s of m.settings) {
                if (s.config && s.scope == "client")
                    this.clientdata[s.id] = s.originalValue;
            };
        };
        this.clientdata = expandObject(this.clientdata);

        // Return data
        return {
            user: game.user,
            canConfigure: canConfigure,
            systemTitle: game.system.data.title,
            data: data
        };
    }

    getClientSetting(namespace, key, storage = {}) {
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
        this.userId = $(ev.currentTarget).val();

        let data = this.getData();
        data.user = game.users.get(this.userId);
        let template = await renderTemplate("templates/sidebar/apps/settings-config.html", data);
        let html = $(template);

        this.activateListeners(html);

        Hooks.callAll('renderSettingsConfig', this, html, data);

        let oldsettings = $('.tab[data-tab="modules"] .settings-list', this.element);
        $('.tab[data-tab="modules"] .settings-list', html).insertAfter(oldsettings);
        oldsettings.remove();

        // if the viewing user has nothing saved yet, warn the GM that they could be overwriting changes made by the player
        let userSaved = (game.users.get(this.userId).data.flags["monks-player-settings"] !== undefined)
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
            if (setting("sync-settings")) {
                let clientSettings = MonksPlayerSettings.cleanSetting(expandObject(duplicate(game.settings.storage.get("client"))));
                await game.users.get(this.userId).update({ "flags.monks-player-settings.client-settings": clientSettings }, { diff: false, recursive: false });
            }
        } else {
            // Need to compare the formData with the client values
            let settings = MonksPlayerSettings.cleanSetting(expandObject(duplicate(formData)));
            let diff = diffObject(this.clientdata, settings);

            await game.users.get(this.userId).update({ "flags.monks-player-settings.gm-settings": diff }, { diff: false, recursive: false });
        }
    }
}

Hooks.on('renderSettingsConfig', (app, html) => {
    if (game.user.isGM) {
        let select = $('<select>')
            .append(game.users.map(u => { return `<option value="${u.id}"${u.id == game.user.id ? ' selected' : ''}>${u.name}</option>` }))
            .on('change', app.changeUserSettings.bind(app));

        if (game.modules.get('tidy-ui_game-settings')?.active)
            $(app.element).addClass('tidy-ui');

        $('div.tab[data-tab="modules"]', html)
            .prepend(
                $('<div>')
                    .addClass('form-group').attr('style', 'flex-direction: row')
                    .append($('<label>').attr('style', "flex: 1; flex-basis: auto !important").html('View settings for Player:'))
                    .append($('<div>').attr('style', "flex: 3; flex-basis: auto !important").addClass('form-fields').append(select))
            );

        app.setPosition({ height: 'auto' });
    }
})